"""The signed-in user, the directory, preferences, and the boot payload."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, conflict, not_found, unique_violation
from ..lib.ids import IdParam, new_id
from ..lib.storage import public_file_url
from ..lib.times import parse_client_time
from ..lib.webpush import send_push
from ..realtime import hub
from ..schemas.base import CamelModel
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
from ..schemas.requests import (
    PushSubscriptionInput,
    PushUnsubscribeInput,
    UpdatePrefsInput,
    UpdateProfileInput,
)
from ..services import channels as channel_service
from ..services import commands as command_service
from ..services import handles as handle_service
from ..services import messages as message_service
from ..services import themes as theme_service
from ..services import user_groups as group_service
from ..services.serialize import USER_COLUMNS, read_prefs, to_current_user, to_user, to_workspace

router = APIRouter(tags=["users"])


class UsersOut(CamelModel):
    users: list[User]


class UserOut(CamelModel):
    user: User


class CurrentUserOut(CamelModel):
    user: CurrentUser


class PrefsOut(CamelModel):
    prefs: UserPrefs


class OkOut(CamelModel):
    ok: bool = True


@router.get("/api/bootstrap", response_model=Bootstrap)
async def bootstrap(user: SessionUser = Depends(current_user)) -> Bootstrap:
    """One request that returns everything the client needs to render.

    Keeping the boot payload to a single round trip is why Slack eventually built
    Flannel; starting here costs nothing and postpones that problem indefinitely.
    """
    # Presets are inserted once per workspace, on the first boot that needs them.
    async with transaction() as (setup, _):
        await theme_service.ensure_presets(setup, user.workspace_id)

    async with session_scope() as session:
        me = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user.id}
            )
        ).fetchone()
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


@router.patch("/api/me", response_model=CurrentUserOut)
async def update_me(
    payload: UpdateProfileInput, user: SessionUser = Depends(current_user)
) -> CurrentUserOut:
    # Absent and explicitly-null are different: the client clears a field by sending
    # null, and omits it to leave it alone.
    given = payload.model_fields_set

    async with transaction() as (session, after):
        avatar_key: str | None = None
        if payload.avatar_attachment_id is not None:
            # The id must name an upload this person made in this workspace — anything
            # else would let a profile point at somebody else's file, or at a key in
            # another tenant, and the files route would happily serve it as an avatar.
            owned = (
                await session.execute(
                    text(
                        """
                        SELECT object_key FROM attachments
                         WHERE id = :id AND uploader_id = :uploader
                           AND workspace_id = :ws AND message_id IS NULL
                        """
                    ),
                    {
                        "id": payload.avatar_attachment_id,
                        "uploader": user.id,
                        "ws": user.workspace_id,
                    },
                )
            ).fetchone()
            if owned is None:
                raise bad_request("That upload is not yours to use as a picture.")
            avatar_key = str(owned.object_key)
        # Renaming can lose two indexes — `users_display_name_uniq` and the handle
        # table's primary key — and both mean the same thing to the person typing.
        # Neither was caught before: this route imported only `not_found`, so taking a
        # name somebody else held came back as a 500 from the catch-all handler.
        try:
            await _write_profile(session, user, payload, given, avatar_key)
        except Exception as exc:
            if unique_violation(exc):
                raise conflict("That display name is taken.", "name_taken") from exc
            raise

        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user.id}
            )
        ).fetchone()
        if row is None:
            raise not_found("That account no longer exists.")
        public = to_user(row)
        after.add(
            lambda: hub.to_workspace(
                user.workspace_id,
                {"t": "user.updated", "user": public.model_dump(by_alias=True)},
            )
        )

    return CurrentUserOut(user=to_current_user(row))


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


async def _write_profile(
    session: AsyncSession,
    user: SessionUser,
    payload: UpdateProfileInput,
    given: set[str],
    avatar_key: str | None = None,
) -> None:
    """The two writes a profile edit makes, so the caller can wrap both in one guard."""
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
    # Only on an actual rename: the UPDATE above COALESCEs, so a None leaves the name
    # alone and re-claiming it would collide with the row this person already holds.
    if payload.display_name is not None:
        await handle_service.rehandle_user(
            session, user.workspace_id, user.id, payload.display_name
        )


@router.patch("/api/me/prefs", response_model=PrefsOut)
async def update_prefs(
    payload: UpdatePrefsInput, user: SessionUser = Depends(current_user)
) -> PrefsOut:
    # Preferences merge rather than replace, so a client that knows about fewer keys
    # than the server can still save the ones it does know.
    patch = payload.model_dump(by_alias=True, exclude_unset=True)

    async with transaction() as (session, _):
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
                {"id": user.id, "patch": json.dumps(patch)},
            )
        ).fetchone()
    if row is None:
        raise not_found("That account no longer exists.")
    return PrefsOut(prefs=read_prefs(row.prefs))


@router.get("/api/users", response_model=UsersOut)
async def list_users(user: SessionUser = Depends(current_user)) -> UsersOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT {USER_COLUMNS} FROM users
                     WHERE workspace_id = :ws ORDER BY lower(display_name) LIMIT 1000
                    """
                ),
                {"ws": user.workspace_id},
            )
        ).fetchall()
    return UsersOut(users=[to_user(row) for row in rows])


@router.get("/api/users/{user_id}", response_model=UserOut)
async def get_user(user_id: IdParam, user: SessionUser = Depends(current_user)) -> UserOut:
    async with session_scope() as session:
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id AND workspace_id = :ws"),
                {"id": user_id, "ws": user.workspace_id},
            )
        ).fetchone()
    if row is None:
        raise not_found("There is no such person here.")
    return UserOut(user=to_user(row))


# ─── web push ─────────────────────────────────────────────────────────────────
class PushKeyOut(CamelModel):
    #: Null when the server has no VAPID keys — the client shows "not set up" rather
    #: than a subscribe button that cannot work.
    key: str | None


@router.get("/api/me/push-public-key", response_model=PushKeyOut)
async def push_public_key(user: SessionUser = Depends(current_user)) -> PushKeyOut:
    """The VAPID public key a browser needs to subscribe.

    The private half never leaves the server; this is the applicationServerKey handed
    to `pushManager.subscribe`, and it is not a secret — every subscribed browser
    holds it. It still sits behind the session cookie like everything else.
    """
    return PushKeyOut(key=settings.VAPID_PUBLIC_KEY if settings.push_enabled else None)


class PushTestOut(CamelModel):
    ok: bool = True
    #: How many of the caller's devices were pushed at. Zero means "subscribe first",
    #: which the settings screen already prevents by only offering the button when on.
    sent: int


@router.post("/api/me/push-test", response_model=PushTestOut)
async def push_test(user: SessionUser = Depends(current_user)) -> PushTestOut:
    """Send yourself a test notification, so "did I set this up right" has a button.

    The push path crosses VAPID keys, a service worker, an OS permission and a
    third-party push service; when it fails, it fails silently at whichever link is
    broken. A test the person can trigger is the only way to verify the whole chain.
    """
    if not settings.push_enabled:
        raise bad_request("The server has no push keys configured.")
    async with session_scope() as session:
        subs = (
            await session.execute(
                text(
                    """
                    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
                     WHERE user_id = :id
                    """
                ),
                {"id": user.id},
            )
        ).fetchall()
    if not subs:
        return PushTestOut(sent=0)
    dead = await send_push(
        subs,
        {
            "title": "Blob",
            "body": "Push works on this device.",
            "url": "/",
            "tag": "push-test",
        },
    )
    if dead:
        async with transaction() as (session, _):
            await session.execute(
                text("DELETE FROM push_subscriptions WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": dead},
            )
    return PushTestOut(sent=len(subs) - len(dead))


@router.post("/api/me/push-subscription", response_model=OkOut)
async def add_push_subscription(
    payload: PushSubscriptionInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
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
            {
                "id": new_id(),
                "user_id": user.id,
                "endpoint": payload.endpoint,
                "p256dh": payload.keys.p256dh,
                "auth": payload.keys.auth,
            },
        )
    return OkOut()


@router.delete("/api/me/push-subscription", response_model=OkOut)
async def remove_push_subscription(
    payload: PushUnsubscribeInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                DELETE FROM push_subscriptions
                 WHERE user_id = :user_id AND endpoint = :endpoint
                """
            ),
            {"user_id": user.id, "endpoint": payload.endpoint},
        )
    return OkOut()


__all__ = ["router"]
