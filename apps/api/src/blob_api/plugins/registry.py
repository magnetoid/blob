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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_token
from ..lib.errors import bad_request, conflict, not_found, unique_violation
from ..lib.ids import new_id, new_token
from ..services import handles as handle_service
from .manifest import (
    VERSION_RE,
    CommandDecl,
    Manifest,
    Status,
    new_scopes,
    validate_manifest,
)
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
    #: Set for a container agent. The check constraint is evaluated per statement, so
    #: this belongs in the INSERT rather than an UPDATE that follows it.
    source_repo: str | None = None,
    source_ref: str | None = None,
    #: Names the built-ins already hold. Passed in because those live a layer above.
    reserved_commands: frozenset[str] = frozenset(),
    #: True only when Blob is seeding its own agent. Defaults to false so that a route
    #: reaching this without thinking about it gets the refusal rather than the exemption.
    trusted: bool = False,
) -> Installed:
    validate_manifest(manifest, reserved_commands=reserved_commands, trusted=trusted)

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
               request_url, agui_url, events, installed_by, source_repo, source_ref,
               deployment_status)
            VALUES
              (:id, :ws, :slug, :name, :description, :runtime, :version,
               :request_url, :agui_url, cast(:events AS text[]), :installed_by,
               :source_repo, :source_ref, :deployment_status)
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
            "agui_url": manifest.agui_url,
            "events": manifest.events,
            "installed_by": installed_by,
            "source_repo": source_repo,
            "source_ref": source_ref,
            "deployment_status": "pending" if source_repo else None,
        },
    )

    secret = new_secret()
    await session.execute(
        text("INSERT INTO plugin_secrets (plugin_id, signing_secret) VALUES (:id, :secret)"),
        {"id": plugin_id, "secret": secret},
    )
    await _write_grants(session, plugin_id, manifest.scopes, installed_by)
    await _write_commands(
        session,
        plugin_id=plugin_id,
        workspace_id=workspace_id,
        commands=manifest.commands,
    )

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
    # A bot is a real users row, so its name is mentionable and has to be allocated the
    # way anybody else's is.
    await handle_service.claim(session, workspace_id, display_name, user_id=user_id)
    return user_id


async def _available_display_name(session: AsyncSession, workspace_id: str, wanted: str) -> str:
    """Find a mentionable name this bot can have, suffixing until one is free.

    A bot named after somebody who already exists would fail the insert, so a suffix is
    added rather than refusing an otherwise valid install.

    Probes `workspace_handles` rather than `users`, which is the difference between
    stepping around a person and stepping around anything mentionable: an app whose
    manifest name matches a *group* handle would otherwise mint a colliding bot on the
    first attempt. This is the one honest place for a probe — it is picking a free name,
    not guarding a write, and the claim in `_create_bot_user` is still what decides.
    """
    base = wanted.strip()[:60] or "App"
    for attempt in range(20):
        candidate = base if attempt == 0 else f"{base} {attempt + 1}"
        if not await handle_service.is_taken(session, workspace_id, candidate):
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


async def _write_commands(
    session: AsyncSession,
    *,
    plugin_id: str,
    workspace_id: str,
    commands: list[CommandDecl],
) -> None:
    """Replace this app's commands with what its manifest now declares.

    Deleting first is what makes an update that *drops* a command actually drop it, and
    what lets an app rename one without colliding with itself.

    A name another app already holds surfaces as a unique violation, which is the point:
    two installs racing for `/deploy` both pass any check that could be written here, and
    only one can win an index. The loser is told which name it lost rather than being
    given a partial install.
    """
    await session.execute(
        text("DELETE FROM plugin_commands WHERE plugin_id = :id"), {"id": plugin_id}
    )

    for command in commands:
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO plugin_commands (id, plugin_id, workspace_id, name, usage, summary)
                    VALUES (:id, :plugin_id, :ws, :name, :usage, :summary)
                    """
                ),
                {
                    "id": new_id(),
                    "plugin_id": plugin_id,
                    "ws": workspace_id,
                    "name": command.name,
                    "usage": command.usage,
                    "summary": command.summary,
                },
            )
        except IntegrityError as exc:
            if not unique_violation(exc):
                raise
            raise conflict(
                f"/{command.name} is already provided by another app.",
                "command_conflict",
            ) from exc


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
    reserved_commands: frozenset[str] = frozenset(),
) -> list[str]:
    """Apply a new manifest. Returns scopes that need approval before events resume."""
    validate_manifest(manifest, reserved_commands=reserved_commands)
    existing = await by_id(session, plugin_id, workspace_id)
    if manifest.slug != existing.slug:
        raise bad_request("An app's slug cannot change after install.", code="slug_immutable")

    previous = await granted_scopes(session, plugin_id)
    already_pending = set(existing.pending_scopes or [])
    # Measured against what a person approved, not against the grants table: grants
    # include scopes still awaiting review, and an update that re-requests one of those
    # must not launder it into "already granted" by having asked twice.
    approved = sorted(set(previous) - already_pending)
    widened = new_scopes(approved, manifest.scopes)

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
    await _write_commands(
        session,
        plugin_id=plugin_id,
        workspace_id=workspace_id,
        commands=manifest.commands,
    )

    if widened:
        status = "needs_review"
    elif existing.status == "needs_review" and already_pending:
        # The update withdrew the scopes that parked it; nothing is left to review.
        status = "enabled"
    else:
        status = existing.status
    await session.execute(
        text(
            """
            UPDATE plugins
               SET name = :name, description = :description, version = :version,
                   request_url = :request_url, agui_url = :agui_url,
                   events = cast(:events AS text[]),
                   pending_scopes = cast(:pending AS text[]),
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
            "agui_url": manifest.agui_url,
            "events": manifest.events,
            "pending": widened,
            "status": status,
        },
    )
    return widened


#: The same bounds `Manifest` puts on a registered app — see `plugins/manifest.py`.
MAX_AGENT_NAME = 80
MAX_AGENT_DESCRIPTION = 500


def _within(value: str | None, limit: int) -> str | None:
    """The value if it is a usable string of the right size, else nothing."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed and len(trimmed) <= limit else None


async def describe(
    session: AsyncSession,
    *,
    plugin_id: str,
    workspace_id: str,
    name: str | None = None,
    description: str | None = None,
    version: str | None = None,
) -> None:
    """Record what a socket agent says it is, on the way in.

    This is the whole of "importing" a desktop agent: it connects and announces itself,
    rather than being described by hand in a console it has never heard of.

    Only the descriptive fields. Scopes, events and commands are conspicuously absent —
    an agent that could widen its own grants by asserting them on connect would make the
    consent screen decorative. Those still go through `update`, which parks new scopes in
    `needs_review` where a person sees them.

    Each field is optional and a missing one leaves what was there: an agent that sends a
    name and no description should not blank the description an admin wrote.

    And each is held to the same bounds `Manifest` holds a registered app to. This
    arrives in a `hello` frame from a process on somebody's laptop, and the frame cap is
    512KB: without this an agent could store half a megabyte of text in its own name and
    have every admin console render it on every load. A field that fails is dropped
    rather than refusing the connection — the agent is otherwise working, and an agent
    that cannot connect because its version string has four parts is a worse outcome
    than one listed under the version it last announced properly.
    """
    await by_id(session, plugin_id, workspace_id)
    fields = {
        "name": _within(name, MAX_AGENT_NAME),
        "description": _within(description, MAX_AGENT_DESCRIPTION),
        # `isinstance` and not merely truthiness: this comes off an unschema'd `hello`
        # frame, and an integer build number — which any client that JSON-encodes one
        # produces — made `re.match` raise TypeError out of the handshake and drop the
        # connection.
        "version": (version if isinstance(version, str) and VERSION_RE.match(version) else None),
    }
    given = {key: value for key, value in fields.items() if value}
    if not given:
        return

    # Interpolated, and safe because the keys are the literal three above — never
    # anything the agent sent. Only the *values* come from the wire, and those are bound.
    assignments = ", ".join(f"{key} = :{key}" for key in given)
    await session.execute(
        text(f"UPDATE plugins SET {assignments}, updated_at = now() WHERE id = :id"),
        {**given, "id": plugin_id},
    )


async def approve(session: AsyncSession, plugin_id: str, workspace_id: str) -> list[str]:
    """Accept an update's widened scopes and let the app run again.

    Returns the scopes that were awaiting review, for the audit trail — the record
    should say what was consented to, not merely that consent happened.
    """
    plugin = await by_id(session, plugin_id, workspace_id)
    if plugin.status != "needs_review":
        raise bad_request("That app is not waiting for review.", code="not_pending")
    accepted = list(plugin.pending_scopes or [])
    await session.execute(
        text("UPDATE plugins SET pending_scopes = '{}', updated_at = now() WHERE id = :id"),
        {"id": plugin_id},
    )
    await set_status(session, plugin_id, workspace_id, "enabled")
    return accepted


async def decline_scopes(session: AsyncSession, plugin_id: str, workspace_id: str) -> list[str]:
    """Refuse an update's widened scopes; the app runs on with what it had.

    The update itself stands — name, version, URL and events were applied when it
    landed — but the grants it asked for beyond the approved set are removed, so the
    callback API refuses them no matter what the app's new code tries. Declining is not
    disabling: the answer to "no, not those permissions" should not be an outage.

    If `commands` was among the declined scopes, the commands the update registered go
    with it — they existed only on the strength of the scope being granted.
    """
    plugin = await by_id(session, plugin_id, workspace_id)
    declined = list(plugin.pending_scopes or [])
    if plugin.status != "needs_review" or not declined:
        raise bad_request("That app is not waiting for review.", code="not_pending")
    await session.execute(
        text(
            "DELETE FROM plugin_grants"
            " WHERE plugin_id = :id AND scope = ANY(cast(:scopes AS text[]))"
        ),
        {"id": plugin_id, "scopes": declined},
    )
    if "commands" in declined:
        await session.execute(
            text("DELETE FROM plugin_commands WHERE plugin_id = :id"), {"id": plugin_id}
        )
    await session.execute(
        text("UPDATE plugins SET pending_scopes = '{}', updated_at = now() WHERE id = :id"),
        {"id": plugin_id},
    )
    await set_status(session, plugin_id, workspace_id, "enabled")
    return declined


async def set_budget(
    session: AsyncSession,
    plugin_id: str,
    workspace_id: str,
    *,
    runs_per_day: int | None,
    seconds_per_day: int | None,
) -> None:
    """Cap what this agent may spend in a trailing day. NULL lifts the cap.

    Admin-set only, and deliberately not a manifest field — an app that could budget
    itself by shipping an update would make the cap decorative.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text(
            """
            UPDATE plugins
               SET budget_runs_per_day = :runs, budget_seconds_per_day = :seconds,
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": plugin_id, "runs": runs_per_day, "seconds": seconds_per_day},
    )


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
    """Remove the app and retire its bot, keeping everything the bot ever said.

    Retiring an account is not the same as freeing what it held, and this path was
    keeping two things hostage that an admin deactivating a person releases.

    The bot's *address* is derived from the slug, so a retired bot occupied the identity
    of the app it used to be: reinstalling the same app inserted a second `users` row
    with the same email in the same workspace, hit `users_workspace_id_email_key`, and
    answered 500 with no way back short of editing the database. The address is mangled
    rather than the row deleted, because `author_id` on every message the bot ever sent
    still points at it. `.invalid` is unroutable by RFC, so nothing is lost by changing it.

    The bot's *handle* is the other one. `workspace_handles` is documented as holding
    rows for active users only, and `mention_targets` reads it with no `deactivated_at`
    filter because of that — so a retired bot stayed mentionable, and its name stayed
    unclaimable by anyone else, for ever.
    """
    await by_id(session, plugin_id, workspace_id)
    retired = (
        await session.execute(
            text(
                """
                UPDATE users
                   SET deactivated_at = now(),
                       bot_plugin_id = NULL,
                       email = split_part(email, '@', 1) || '+' || id::text
                               || '@' || split_part(email, '@', 2)
                 WHERE bot_plugin_id = :id
                RETURNING id
                """
            ),
            {"id": plugin_id},
        )
    ).fetchall()
    for row in retired:
        await handle_service.release_user(session, str(row.id))
    # Grants, secrets, tokens and queued deliveries cascade from the plugin row.
    await session.execute(text("DELETE FROM plugins WHERE id = :id"), {"id": plugin_id})


async def bot_user_id(session: AsyncSession, plugin_id: str) -> str | None:
    row = (
        await session.execute(
            text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
        )
    ).fetchone()
    return row.id if row else None
