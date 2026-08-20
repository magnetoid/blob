"""The signed-in user, the directory, preferences, and the boot payload."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..lib.storage import public_file_url
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import Bootstrap, CurrentUser, CustomEmoji, User, UserPrefs
from ..schemas.requests import (
    PushSubscriptionInput,
    PushUnsubscribeInput,
    UpdatePrefsInput,
    UpdateProfileInput,
)
from ..services import channels as channel_service
from ..services.serialize import USER_COLUMNS, to_current_user, to_user, to_workspace

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

    return Bootstrap(
        workspace=to_workspace(workspace),
        user=to_current_user(me),
        users=[to_user(row) for row in users],
        channels=channels,
        custom_emoji=[
            CustomEmoji(name=row.name, url=public_file_url(row.object_key)) for row in emoji
        ],
    )


@router.patch("/api/me", response_model=CurrentUserOut)
async def update_me(
    payload: UpdateProfileInput, user: SessionUser = Depends(current_user)
) -> CurrentUserOut:
    # Absent and explicitly-null are different: the client clears a field by sending
    # null, and omits it to leave it alone.
    given = payload.model_fields_set

    async with transaction() as (session, after):
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
                            ELSE status_expires_at END
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
                "status_expires_at": payload.status_expires_at,
            },
        )
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user.id}
            )
        ).fetchone()
        if row is None:
            raise not_found("That account no longer exists.")
        public = to_user(row)
        after.add(
            lambda: hub.to_all({"t": "user.updated", "user": public.model_dump(by_alias=True)})
        )

    return CurrentUserOut(user=to_current_user(row))


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
    return PrefsOut(prefs=UserPrefs.model_validate(row.prefs or {}))


@router.get("/api/users", response_model=UsersOut)
async def list_users(user: SessionUser = Depends(current_user)) -> UsersOut:
    async with session_scope() as session:
        rows = (
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
    return UsersOut(users=[to_user(row) for row in rows])


@router.get("/api/users/{user_id}", response_model=UserOut)
async def get_user(user_id: str, user: SessionUser = Depends(current_user)) -> UserOut:
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


# ─── admin ────────────────────────────────────────────────────────────────────
@router.post("/api/admin/users/{user_id}/deactivate", response_model=OkOut)
async def deactivate_user(user_id: str, admin: SessionUser = Depends(require_admin)) -> OkOut:
    """Deactivation keeps the person's messages but ends their access immediately."""
    if user_id == admin.id:
        raise bad_request("You cannot deactivate your own account.")

    async with transaction() as (session, after):
        target = (
            await session.execute(
                text("SELECT role FROM users WHERE id = :id AND workspace_id = :ws"),
                {"id": user_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if target is None:
            raise not_found("There is no such person here.")
        if target.role == "owner":
            raise bad_request("The workspace owner cannot be deactivated.")

        await session.execute(
            text(
                """
                UPDATE users SET deactivated_at = now()
                 WHERE id = :id AND workspace_id = :ws
                """
            ),
            {"id": user_id, "ws": admin.workspace_id},
        )
        await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()

        def broadcast() -> None:
            for conn in hub.connections_for_user(user_id):
                conn.close()
            if row is not None:
                hub.to_all({"t": "user.updated", "user": to_user(row).model_dump(by_alias=True)})

        after.add(broadcast)

    return OkOut()


@router.post("/api/admin/users/{user_id}/reactivate", response_model=OkOut)
async def reactivate_user(user_id: str, admin: SessionUser = Depends(require_admin)) -> OkOut:
    async with transaction() as (session, after):
        # The display-name unique index is partial (WHERE deactivated_at IS NULL), so
        # reactivating into a name someone else took would raise a raw 23505.
        clash = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM users active
                     WHERE active.workspace_id = :ws
                       AND active.deactivated_at IS NULL
                       AND lower(active.display_name) = (
                             SELECT lower(display_name) FROM users WHERE id = :id)
                    """
                ),
                {"id": user_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if clash is not None:
            raise bad_request("Someone else is using that display name now. Rename them first.")

        await session.execute(
            text("UPDATE users SET deactivated_at = NULL WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": admin.workspace_id},
        )
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()
        if row is not None:
            public = to_user(row)
            after.add(
                lambda: hub.to_all({"t": "user.updated", "user": public.model_dump(by_alias=True)})
            )

    return OkOut()


# ─── web push ─────────────────────────────────────────────────────────────────
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
