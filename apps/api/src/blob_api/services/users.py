"""The signed-in person, the directory, preferences, push subscriptions, and boot.

The SQL behind `routers/users.py`. `bootstrap` composes the one payload the client
renders from, which is why it reaches into half the other services: keeping boot to a
single round trip is why Slack eventually built Flannel, and starting here costs nothing
and postpones that problem indefinitely.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.auth import SessionUser
from ..lib.errors import bad_request, conflict, no_such_person, not_found, unique_violation
from ..lib.ids import new_id
from ..lib.storage import is_inline_image, public_file_url
from ..lib.times import parse_client_time
from ..schemas.models import (
    Bootstrap,
    CommandSpec,
    CurrentUser,
    CustomEmoji,
    ThemeSummary,
    User,
    UserGroup,
    UserPrefs,
)
from ..schemas.requests import UpdateProfileInput
from . import channels as channel_service
from . import commands as command_service
from . import handles as handle_service
from . import messages as message_service
from . import themes as theme_service
from . import user_groups as group_service
from .serialize import USER_COLUMNS, read_prefs, to_current_user, to_user, to_workspace


async def _row(session: AsyncSession, user_id: str) -> Any:
    return (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
        )
    ).fetchone()


async def bootstrap(session: AsyncSession, user: SessionUser) -> Bootstrap:
    """Everything the client needs to render, in one answer."""
    me = await _row(session, user.id)
    workspace = (
        await session.execute(
            text("SELECT id, name, slug, created_at FROM workspaces WHERE id = :id"),
            {"id": user.workspace_id},
        )
    ).fetchone()
    if me is None or workspace is None:
        raise not_found("That workspace no longer exists.")

    users = (
        await session.execute(
            text(
                f"""
                SELECT {USER_COLUMNS} FROM users
                 WHERE workspace_id = :ws ORDER BY lower(display_name)
                """
            ),
            {"ws": user.workspace_id},
        )
    ).fetchall()
    emoji = (
        await session.execute(
            text(
                """
                SELECT name, object_key FROM custom_emoji
                 WHERE workspace_id = :ws ORDER BY name
                """
            ),
            {"ws": user.workspace_id},
        )
    ).fetchall()
    channels = await channel_service.list_for_user(session, user.id, user.workspace_id)
    themes = await theme_service.list_themes(session, user.workspace_id)
    app_commands = await command_service.app_specs(session, user.workspace_id, user.id)
    saved_ids = await message_service.saved_message_ids(session, user.id)
    groups = await group_service.list_for_workspace(session, user.workspace_id)
    my_group_ids = await group_service.group_ids_for_user(session, user.id)
    muted_group_ids = await group_service.muted_group_ids_for_user(session, user.id)

    return Bootstrap(
        workspace=to_workspace(workspace),
        user=to_current_user(me),
        users=[to_user(row) for row in users],
        channels=channels,
        custom_emoji=[
            CustomEmoji(name=row.name, url=public_file_url(row.object_key)) for row in emoji
        ],
        # Built-ins and app commands in one list, sorted together. The composer should
        # not care which is which, and a name can only belong to one of them anyway —
        # an app is refused a built-in's name at install.
        commands=sorted(
            [
                CommandSpec(name=c.name, usage=c.usage, summary=c.summary)
                for c in command_service.ordered()
            ]
            + [
                CommandSpec(name=name, usage=usage, summary=summary)
                for name, usage, summary in app_commands
            ],
            key=lambda c: c.name,
        ),
        themes=[
            ThemeSummary(
                id=theme.id,
                slug=theme.slug,
                name=theme.name,
                mode=theme.mode,
                tokens=theme.tokens,
                is_preset=theme.is_preset,
                is_enabled=theme.is_enabled,
            )
            for theme in themes
            if theme.is_enabled
        ],
        saved_message_ids=saved_ids,
        groups=[
            UserGroup(
                id=g.id,
                handle=g.handle,
                name=g.name,
                description=g.description,
                member_count=g.member_count,
            )
            for g in groups
        ],
        my_group_ids=my_group_ids,
        muted_group_ids=muted_group_ids,
        # Trimmed and bounded rather than passed through: it is an environment variable
        # set by whoever deployed, so it is operator input, and a 40-character hex string
        # is the whole of what it can usefully be.
        server_commit=(settings.SOURCE_COMMIT or "").strip()[:40] or None,
    )


def _status_expiry(payload: UpdateProfileInput, given: set[str]) -> datetime | None:
    """The moment a status stops applying, as a datetime asyncpg will accept.

    The field arrives as an ISO string and was bound straight into
    `cast(:status_expires_at AS timestamptz)`. asyncpg reads the cast as the *parameter's*
    type and refuses a `str` outright — `expected a datetime.date or datetime.datetime
    instance, got 'str'` — so every attempt to set an expiry was a 500. The column, the
    schema and `serialize.to_user`'s expiry check were all correct and had never once
    been reached: the feature could not be used from any client.

    Parsed here rather than typed as a `datetime` on the model so the refusal matches
    what `later` and `schedule` already say about a bad time, which is the wording the
    client shows.
    """
    if "status_expires_at" not in given or payload.status_expires_at is None:
        return None
    return parse_client_time(payload.status_expires_at)


async def _avatar_key(session: AsyncSession, user: SessionUser, attachment_id: str) -> str:
    # The id must name an upload this person made in this workspace — anything else
    # would let a profile point at somebody else's file, or at a key in another tenant,
    # and the files route would happily serve it as an avatar.
    owned = (
        await session.execute(
            text(
                """
                SELECT object_key, mime FROM attachments
                 WHERE id = :id AND uploader_id = :uploader
                   AND workspace_id = :ws AND message_id IS NULL
                """
            ),
            {"id": attachment_id, "uploader": user.id, "ws": user.workspace_id},
        )
    ).fetchone()
    if owned is None:
        raise bad_request("That upload is not yours to use as a picture.")
    # A picture, checked here rather than trusted from the ticket. `mime` is whatever
    # the uploader typed — the upload route validates the *extension* and nothing else —
    # and an avatar is the one attachment served inline to the whole workspace.
    # `presign_download` refuses to echo a type it does not allowlist, so this is the
    # second of two locks rather than the only one.
    if not is_inline_image(str(owned.mime)):
        raise bad_request("A profile picture has to be an image.")
    return str(owned.object_key)


async def update_profile(
    session: AsyncSession, user: SessionUser, payload: UpdateProfileInput
) -> tuple[CurrentUser, User]:
    """Write a profile edit; returns the person's own view and the public one to send."""
    # Absent and explicitly-null are different: the client clears a field by sending
    # null, and omits it to leave it alone.
    given = payload.model_fields_set
    avatar_key = (
        await _avatar_key(session, user, payload.avatar_attachment_id)
        if payload.avatar_attachment_id is not None
        else None
    )
    # Renaming can lose two indexes — `users_display_name_uniq` and the handle table's
    # primary key — and both mean the same thing to the person typing. Neither was caught
    # before: the route imported only `not_found`, so taking a name somebody else held
    # came back as a 500 from the catch-all handler.
    try:
        await session.execute(
            text(
                """
                UPDATE users
                   SET display_name = COALESCE(:display_name, display_name),
                       full_name    = CASE WHEN :has_full_name THEN :full_name
                                           ELSE full_name END,
                       title        = CASE WHEN :has_title THEN :title ELSE title END,
                       timezone     = COALESCE(:timezone, timezone),
                       status_emoji = CASE WHEN :has_status_emoji THEN :status_emoji
                                           ELSE status_emoji END,
                       status_text  = CASE WHEN :has_status_text THEN :status_text
                                           ELSE status_text END,
                       status_expires_at = CASE
                            WHEN :has_status_expires THEN cast(:status_expires_at AS timestamptz)
                            ELSE status_expires_at END,
                       avatar_key   = CASE WHEN :has_avatar THEN :avatar_key
                                           ELSE avatar_key END
                 WHERE id = :id
                """
            ),
            {
                "id": user.id,
                "display_name": payload.display_name,
                "has_full_name": "full_name" in given,
                "full_name": payload.full_name,
                "has_title": "title" in given,
                "title": payload.title,
                "timezone": payload.timezone,
                "has_status_emoji": "status_emoji" in given,
                "status_emoji": payload.status_emoji,
                "has_status_text": "status_text" in given,
                "status_text": payload.status_text,
                "has_status_expires": "status_expires_at" in given,
                "status_expires_at": _status_expiry(payload, given),
                "has_avatar": "avatar_attachment_id" in given,
                "avatar_key": avatar_key,
            },
        )
        # Only on an actual rename: the UPDATE above COALESCEs, so a None leaves the
        # name alone and re-claiming it would collide with the row this person holds.
        if payload.display_name is not None:
            await handle_service.rehandle_user(
                session, user.workspace_id, user.id, payload.display_name
            )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict("That display name is taken.", "name_taken") from exc
        raise

    row = await _row(session, user.id)
    if row is None:
        raise not_found("That account no longer exists.")
    return to_current_user(row), to_user(row)


async def update_prefs(session: AsyncSession, user_id: str, patch: dict[str, Any]) -> UserPrefs:
    # Preferences merge rather than replace, so a client that knows about fewer keys
    # than the server can still save the ones it does know.
    row = (
        await session.execute(
            text(
                f"""
                UPDATE users
                   SET prefs = COALESCE(prefs, '{{}}'::jsonb) || cast(:patch AS jsonb)
                 WHERE id = :id
                RETURNING {USER_COLUMNS}
                """
            ),
            {"id": user_id, "patch": json.dumps(patch)},
        )
    ).fetchone()
    if row is None:
        raise not_found("That account no longer exists.")
    return read_prefs(row.prefs)


async def list_users(session: AsyncSession, workspace_id: str) -> list[User]:
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {USER_COLUMNS} FROM users
                 WHERE workspace_id = :ws ORDER BY lower(display_name) LIMIT 1000
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return [to_user(row) for row in rows]


async def get_user(session: AsyncSession, workspace_id: str, user_id: str) -> User:
    row = (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None:
        raise no_such_person()
    return to_user(row)


# ─── web push ─────────────────────────────────────────────────────────────────


async def push_subscriptions(session: AsyncSession, user_id: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
                     WHERE user_id = :id
                    """
                ),
                {"id": user_id},
            )
        ).fetchall()
    )


async def forget_push_subscriptions(session: AsyncSession, ids: list[str]) -> None:
    await session.execute(
        text("DELETE FROM push_subscriptions WHERE id = ANY(cast(:ids AS uuid[]))"),
        {"ids": ids},
    )


async def add_push_subscription(
    session: AsyncSession, user_id: str, *, endpoint: str, p256dh: str, auth: str
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
            VALUES (:id, :user_id, :endpoint, :p256dh, :auth)
            ON CONFLICT (endpoint) DO UPDATE
              SET user_id = EXCLUDED.user_id,
                  p256dh = EXCLUDED.p256dh,
                  auth = EXCLUDED.auth
            """
        ),
        {"id": new_id(), "user_id": user_id, "endpoint": endpoint, "p256dh": p256dh, "auth": auth},
    )


async def remove_push_subscription(session: AsyncSession, user_id: str, endpoint: str) -> None:
    await session.execute(
        text(
            """
            DELETE FROM push_subscriptions
             WHERE user_id = :user_id AND endpoint = :endpoint
            """
        ),
        {"user_id": user_id, "endpoint": endpoint},
    )
