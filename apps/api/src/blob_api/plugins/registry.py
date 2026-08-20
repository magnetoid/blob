"""Installing, updating and retiring plugins.

The one idea worth stating: **a plugin's bot is a real `users` row**, with `kind='bot'`.
That single decision means `messages.author_id` stays a valid foreign key and avatars,
mentions, member lists, DMs and search all work on a bot with no frontend changes
whatever. The client does not need to know bots exist; `messages.kind='bot'` is the only
thing it renders differently.

Uninstalling deactivates that user rather than deleting it. Deleting would null out
`author_id` on every message the app ever posted and turn a year of CI notifications into
messages from nobody.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_token
from ..lib.errors import bad_request, conflict, not_found
from ..lib.ids import new_id, new_token
from .manifest import Manifest, Status, new_scopes, validate_manifest
from .signing import new_secret

#: Bots need an address because `users.email` is NOT NULL and unique per workspace.
#: `.invalid` is reserved by RFC 2606 and can never resolve, so a stray mail send fails
#: rather than reaching a stranger who happens to own the domain.
BOT_EMAIL_DOMAIN = "bots.invalid"


@dataclass(slots=True)
class Installed:
    plugin_id: str
    bot_user_id: str
    #: Shown once at install and never recoverable. Both are secrets the app keeps.
    signing_secret: str
    bot_token: str


def bot_email(slug: str) -> str:
    return f"{slug}@{BOT_EMAIL_DOMAIN}"


async def by_id(session: AsyncSession, plugin_id: str, workspace_id: str) -> Any:
    row = (
        await session.execute(
            text("SELECT * FROM plugins WHERE id = :id AND workspace_id = :ws"),
            {"id": plugin_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("That app is not installed.")
    return row


async def granted_scopes(session: AsyncSession, plugin_id: str) -> list[str]:
    rows = (
        await session.execute(
            text("SELECT scope FROM plugin_grants WHERE plugin_id = :id ORDER BY scope"),
            {"id": plugin_id},
        )
    ).fetchall()
    return [row.scope for row in rows]


async def install(
    session: AsyncSession,
    *,
    workspace_id: str,
    manifest: Manifest,
    installed_by: str,
) -> Installed:
    validate_manifest(manifest)

    taken = (
        await session.execute(
            text("SELECT 1 FROM plugins WHERE workspace_id = :ws AND slug = :slug"),
            {"ws": workspace_id, "slug": manifest.slug},
        )
    ).fetchone()
    if taken is not None:
        raise conflict("An app with that name is already installed.", "plugin_exists")

    plugin_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO plugins
              (id, workspace_id, slug, name, description, runtime, version,
               request_url, events, installed_by)
            VALUES
              (:id, :ws, :slug, :name, :description, :runtime, :version,
               :request_url, cast(:events AS text[]), :installed_by)
            """
        ),
        {
            "id": plugin_id,
            "ws": workspace_id,
            "slug": manifest.slug,
            "name": manifest.name,
            "description": manifest.description,
            "runtime": manifest.runtime,
            "version": manifest.version,
            "request_url": manifest.request_url,
            "events": manifest.events,
            "installed_by": installed_by,
        },
    )

    secret = new_secret()
    await session.execute(
        text("INSERT INTO plugin_secrets (plugin_id, signing_secret) VALUES (:id, :secret)"),
        {"id": plugin_id, "secret": secret},
    )
    await _write_grants(session, plugin_id, manifest.scopes, installed_by)

    bot_user_id = await _create_bot_user(session, workspace_id, plugin_id, manifest)
    token = await mint_token(session, plugin_id)

    return Installed(
        plugin_id=plugin_id,
        bot_user_id=bot_user_id,
        signing_secret=secret,
        bot_token=token,
    )


async def _create_bot_user(
    session: AsyncSession, workspace_id: str, plugin_id: str, manifest: Manifest
) -> str:
    """A real user row, with no password so it can never sign in through the front door."""
    display_name = await _available_display_name(session, workspace_id, manifest.name)
    user_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO users
              (id, workspace_id, email, password_hash, display_name, role, kind, bot_plugin_id)
            VALUES (:id, :ws, :email, NULL, :display_name, 'member', 'bot', :plugin_id)
            """
        ),
        {
            "id": user_id,
            "ws": workspace_id,
            "email": bot_email(manifest.slug),
            "display_name": display_name,
            "plugin_id": plugin_id,
        },
    )
    return user_id


async def _available_display_name(session: AsyncSession, workspace_id: str, wanted: str) -> str:
    """Mentions resolve by display name, and the unique index is partial on active users.

    A bot named after a person who already exists would fail the insert, so a suffix is
    added rather than refusing an otherwise valid install.
    """
    base = wanted.strip()[:60] or "App"
    for attempt in range(20):
        candidate = base if attempt == 0 else f"{base} {attempt + 1}"
        clash = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM users
                     WHERE workspace_id = :ws
                       AND lower(display_name) = lower(:name)
                       AND deactivated_at IS NULL
                    """
                ),
                {"ws": workspace_id, "name": candidate},
            )
        ).fetchone()
        if clash is None:
            return candidate
    raise conflict("Could not find a free name for that app's bot.", "name_unavailable")


async def _write_grants(
    session: AsyncSession, plugin_id: str, scopes: list[str], granted_by: str | None
) -> None:
    for scope in sorted(set(scopes)):
        await session.execute(
            text(
                """
                INSERT INTO plugin_grants (plugin_id, scope, granted_by)
                VALUES (:plugin_id, :scope, :granted_by)
                ON CONFLICT (plugin_id, scope) DO NOTHING
                """
            ),
            {"plugin_id": plugin_id, "scope": scope, "granted_by": granted_by},
        )


async def mint_token(session: AsyncSession, plugin_id: str) -> str:
    """A bearer token for the callback API. Only its hash is stored."""
    token = f"blob-bot-{new_token()}"
    await session.execute(
        text("INSERT INTO bot_tokens (id, plugin_id, token_hash) VALUES (:id, :pid, :hash)"),
        {"id": new_id(), "pid": plugin_id, "hash": hash_token(token)},
    )
    return token


async def update(
    session: AsyncSession,
    *,
    plugin_id: str,
    workspace_id: str,
    manifest: Manifest,
    actor_id: str,
) -> list[str]:
    """Apply a new manifest. Returns scopes that need approval before events resume."""
    validate_manifest(manifest)
    existing = await by_id(session, plugin_id, workspace_id)
    if manifest.slug != existing.slug:
        raise bad_request("An app's slug cannot change after install.", code="slug_immutable")

    previous = await granted_scopes(session, plugin_id)
    widened = new_scopes(previous, manifest.scopes)

    # Scopes that were dropped are revoked immediately; new ones wait for approval.
    for scope in set(previous) - set(manifest.scopes):
        await session.execute(
            text("DELETE FROM plugin_grants WHERE plugin_id = :id AND scope = :scope"),
            {"id": plugin_id, "scope": scope},
        )

    # Grants are written either way, and `needs_review` is what actually stops the app:
    # a plugin that is not `enabled` receives no events and is refused by the callback
    # API, so holding an unreviewed grant gives it nothing. Keeping the requested scopes
    # in the grants table rather than a second pending column means there is one answer
    # to "what does this app ask for", which is the question the consent screen asks.
    await _write_grants(session, plugin_id, manifest.scopes, actor_id)

    status = "needs_review" if widened else existing.status
    await session.execute(
        text(
            """
            UPDATE plugins
               SET name = :name, description = :description, version = :version,
                   request_url = :request_url, events = cast(:events AS text[]),
                   status = :status, updated_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": plugin_id,
            "name": manifest.name,
            "description": manifest.description,
            "version": manifest.version,
            "request_url": manifest.request_url,
            "events": manifest.events,
            "status": status,
        },
    )
    return widened


async def approve(session: AsyncSession, plugin_id: str, workspace_id: str) -> None:
    """Accept an update's widened scopes and let the app run again."""
    plugin = await by_id(session, plugin_id, workspace_id)
    if plugin.status != "needs_review":
        raise bad_request("That app is not waiting for review.", code="not_pending")
    await set_status(session, plugin_id, workspace_id, "enabled")


async def set_status(
    session: AsyncSession, plugin_id: str, workspace_id: str, status: Status
) -> None:
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text("UPDATE plugins SET status = :status, updated_at = now() WHERE id = :id"),
        {"id": plugin_id, "status": status},
    )


async def rotate_secret(session: AsyncSession, plugin_id: str, workspace_id: str) -> str:
    await by_id(session, plugin_id, workspace_id)
    secret = new_secret()
    await session.execute(
        text(
            """
            UPDATE plugin_secrets
               SET signing_secret = :secret, rotated_at = now()
             WHERE plugin_id = :id
            """
        ),
        {"id": plugin_id, "secret": secret},
    )
    return secret


async def uninstall(session: AsyncSession, plugin_id: str, workspace_id: str) -> None:
    """Remove the app and retire its bot, keeping everything the bot ever said."""
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text(
            """
            UPDATE users
               SET deactivated_at = now(), bot_plugin_id = NULL
             WHERE bot_plugin_id = :id
            """
        ),
        {"id": plugin_id},
    )
    # Grants, secrets, tokens and queued deliveries cascade from the plugin row.
    await session.execute(text("DELETE FROM plugins WHERE id = :id"), {"id": plugin_id})


async def bot_user_id(session: AsyncSession, plugin_id: str) -> str | None:
    row = (
        await session.execute(
            text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
        )
    ).fetchone()
    return row.id if row else None
