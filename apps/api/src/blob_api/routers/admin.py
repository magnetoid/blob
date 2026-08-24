"""The superadmin console.

Every mutation here writes an audit row and, where it changes something the client
renders, broadcasts so open sessions update without a refresh.

`owner` is a real role rather than "the admin who signed up first": exactly one exists,
only an owner changes roles, and the last owner cannot be demoted or deactivated.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import (
    SessionUser,
    hash_token,
    require_admin,
    require_instance_admin,
    require_owner,
)
from ..lib.errors import bad_request, conflict, not_found
from ..lib.ids import new_id, new_token
from ..lib.redis import redis
from ..realtime import hub
from ..schemas.base import CamelModel, iso, require_iso
from ..services import audit as audit_service
from ..services import workspaces as workspace_service
from ..services.audit import AuditEntry, actor_for
from ..services.serialize import USER_COLUMNS, to_user

router = APIRouter(tags=["admin"], prefix="/api/admin")


# ─── payloads ─────────────────────────────────────────────────────────────────
class AdminUser(CamelModel):
    """Richer than the public `User`, which deliberately omits email."""

    id: str
    email: str
    display_name: str
    full_name: str | None = None
    title: str | None = None
    role: str
    deactivated_at: str | None = None
    created_at: str
    last_seen_at: str | None = None
    session_count: int = 0
    channel_count: int = 0
    message_count: int = 0


class AdminUsersOut(CamelModel):
    users: list[AdminUser]
    total: int


class RoleInput(CamelModel):
    role: Literal["member", "admin", "owner"]


class AdminChannel(CamelModel):
    id: str
    kind: str
    name: str | None
    topic: str | None
    created_by: str | None
    created_at: str
    archived_at: str | None
    member_count: int
    message_count: int
    last_message_at: str | None


class AdminChannelsOut(CamelModel):
    channels: list[AdminChannel]


class AdminInvite(CamelModel):
    id: str
    email: str | None
    role: str
    created_by: str | None
    created_by_name: str | None
    created_at: str
    expires_at: str
    accepted_at: str | None
    accepted_by_name: str | None
    revoked_at: str | None
    status: Literal["pending", "accepted", "expired", "revoked"]


class AdminInvitesOut(CamelModel):
    invites: list[AdminInvite]


class AuditOut(CamelModel):
    events: list[AuditEntry]


class WorkspaceSettingsOut(CamelModel):
    name: str
    slug: str
    settings: dict[str, Any]


class SettingsInput(CamelModel):
    name: str | None = None
    settings: dict[str, Any] | None = None


class HealthOut(CamelModel):
    database: bool
    redis: bool
    queue_depth: int
    connections: int
    users_online: int
    message_count: int
    storage_bytes: int
    version: str


class OkOut(CamelModel):
    ok: bool = True


class WebhookOut(CamelModel):
    id: str
    name: str
    channel_id: str
    created_at: str
    last_used_at: str | None
    #: Returned once, at creation. The raw token is never recoverable afterwards.
    url: str | None = None


class WebhooksOut(CamelModel):
    webhooks: list[WebhookOut]


class CreateWebhookInput(CamelModel):
    channel_id: str
    name: str


# ─── people ───────────────────────────────────────────────────────────────────
@router.get("/users", response_model=AdminUsersOut)
async def list_users(
    q: str | None = None,
    include_deactivated: bool = True,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    admin: SessionUser = Depends(require_admin),
) -> AdminUsersOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.email, u.display_name, u.full_name, u.title, u.role,
                           u.deactivated_at, u.created_at,
                           (SELECT max(s.last_seen_at) FROM sessions s
                             WHERE s.user_id = u.id) AS last_seen_at,
                           (SELECT count(*) FROM sessions s
                             WHERE s.user_id = u.id AND s.expires_at > now())::int
                             AS session_count,
                           (SELECT count(*) FROM channel_members cm
                             WHERE cm.user_id = u.id)::int AS channel_count,
                           (SELECT count(*) FROM messages m
                             WHERE m.author_id = u.id AND m.deleted_at IS NULL)::int
                             AS message_count,
                           count(*) OVER ()::int AS total
                      FROM users u
                     WHERE u.workspace_id = :ws
                       AND (:include_deactivated OR u.deactivated_at IS NULL)
                       AND (cast(:q AS text) IS NULL
                            OR u.display_name ILIKE '%' || :q || '%'
                            OR u.email ILIKE '%' || :q || '%')
                     ORDER BY u.deactivated_at NULLS FIRST, lower(u.display_name)
                     LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "ws": admin.workspace_id,
                    "include_deactivated": include_deactivated,
                    "q": q,
                    "limit": limit,
                    "offset": offset,
                },
            )
        ).fetchall()

    return AdminUsersOut(
        users=[
            AdminUser(
                id=row.id,
                email=row.email,
                display_name=row.display_name,
                full_name=row.full_name,
                title=row.title,
                role=row.role,
                deactivated_at=iso(row.deactivated_at),
                created_at=require_iso(row.created_at),
                last_seen_at=iso(row.last_seen_at),
                session_count=row.session_count,
                channel_count=row.channel_count,
                message_count=row.message_count,
            )
            for row in rows
        ],
        total=rows[0].total if rows else 0,
    )


@router.put("/users/{user_id}/role", response_model=OkOut)
async def set_role(
    user_id: str,
    payload: RoleInput,
    request: Request,
    owner: SessionUser = Depends(require_owner),
) -> OkOut:
    """Only an owner changes roles, and ownership transfers rather than duplicates."""
    async with transaction() as (session, after):
        target = (
            await session.execute(
                text(
                    "SELECT id, role, display_name FROM users WHERE id = :id AND workspace_id = :ws"
                ),
                {"id": user_id, "ws": owner.workspace_id},
            )
        ).fetchone()
        if target is None:
            raise not_found("There is no such person here.")
        if target.role == payload.role:
            return OkOut()
        if target.id == owner.id:
            raise bad_request("You cannot change your own role. Transfer ownership instead.")

        if payload.role == "owner":
            # Exactly one owner: promoting someone demotes the current one.
            await session.execute(
                text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": owner.id}
            )
        await session.execute(
            text("UPDATE users SET role = :role WHERE id = :id"),
            {"id": user_id, "role": payload.role},
        )

        await audit_service.record(
            session,
            actor_for(request, owner),
            "user.role_changed",
            target_type="user",
            target_id=user_id,
            metadata={"from": target.role, "to": payload.role},
        )

        changed = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": [user_id, owner.id]},
            )
        ).fetchall()
        updates = [to_user(row) for row in changed]

        def broadcast_roles() -> None:
            for updated in updates:
                hub.to_all({"t": "user.updated", "user": updated.model_dump(by_alias=True)})

        after.add(broadcast_roles)

    return OkOut()


@router.post("/users/{user_id}/deactivate", response_model=OkOut)
async def deactivate(
    user_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
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
            text("UPDATE users SET deactivated_at = now() WHERE id = :id"), {"id": user_id}
        )
        await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
        await audit_service.record(
            session,
            actor_for(request, admin),
            "user.deactivated",
            target_type="user",
            target_id=user_id,
        )
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()
        updated = to_user(row) if row else None

        def broadcast() -> None:
            for conn in hub.connections_for_user(user_id):
                conn.close()
            if updated is not None:
                hub.to_all({"t": "user.updated", "user": updated.model_dump(by_alias=True)})

        after.add(broadcast)

    return OkOut()


@router.post("/users/{user_id}/reactivate", response_model=OkOut)
async def reactivate(
    user_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        # The display-name unique index is partial (WHERE deactivated_at IS NULL), so
        # reactivating into a name someone took since would raise a raw 23505.
        clash = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM users active
                     WHERE active.workspace_id = :ws
                       AND active.deactivated_at IS NULL
                       AND lower(active.display_name) =
                           (SELECT lower(display_name) FROM users WHERE id = :id)
                    """
                ),
                {"id": user_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if clash is not None:
            raise conflict("Someone else uses that display name now. Rename them first.")

        await session.execute(
            text("UPDATE users SET deactivated_at = NULL WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": admin.workspace_id},
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "user.reactivated",
            target_type="user",
            target_id=user_id,
        )
        row = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()
        if row is not None:
            updated = to_user(row)
            after.add(
                lambda: hub.to_all({"t": "user.updated", "user": updated.model_dump(by_alias=True)})
            )

    return OkOut()


@router.post("/users/{user_id}/revoke-sessions", response_model=OkOut)
async def revoke_sessions(
    user_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Sign someone out of every device without disabling their account."""
    async with transaction() as (session, after):
        await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
        await audit_service.record(
            session,
            actor_for(request, admin),
            "user.sessions_revoked",
            target_type="user",
            target_id=user_id,
        )

        def disconnect() -> None:
            for conn in hub.connections_for_user(user_id):
                conn.close()

        after.add(disconnect)
    return OkOut()


# ─── invitations ──────────────────────────────────────────────────────────────
@router.get("/invites", response_model=AdminInvitesOut)
async def list_invites(admin: SessionUser = Depends(require_admin)) -> AdminInvitesOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT i.id, i.email, i.role, i.created_by, i.created_at, i.expires_at,
                           i.accepted_at, i.revoked_at,
                           c.display_name AS created_by_name,
                           a.display_name AS accepted_by_name
                      FROM invites i
                      LEFT JOIN users c ON c.id = i.created_by
                      LEFT JOIN users a ON a.id = i.accepted_by
                     WHERE i.workspace_id = :ws
                     ORDER BY i.id DESC
                     LIMIT 200
                    """
                ),
                {"ws": admin.workspace_id},
            )
        ).fetchall()

    def status(row: Any) -> str:
        if row.accepted_at:
            return "accepted"
        if row.revoked_at:
            return "revoked"
        return "pending" if require_iso(row.expires_at) > require_iso_now() else "expired"

    return AdminInvitesOut(
        invites=[
            AdminInvite(
                id=row.id,
                email=row.email,
                role=row.role,
                created_by=row.created_by,
                created_by_name=row.created_by_name,
                created_at=require_iso(row.created_at),
                expires_at=require_iso(row.expires_at),
                accepted_at=iso(row.accepted_at),
                accepted_by_name=row.accepted_by_name,
                revoked_at=iso(row.revoked_at),
                status=status(row),
            )
            for row in rows
        ]
    )


def require_iso_now() -> str:
    from datetime import UTC, datetime

    return require_iso(datetime.now(UTC))


@router.delete("/invites/{invite_id}", response_model=OkOut)
async def revoke_invite(
    invite_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _):
        rows = (
            await session.execute(
                text(
                    """
                    UPDATE invites SET revoked_at = now()
                     WHERE id = :id AND workspace_id = :ws AND accepted_at IS NULL
                    RETURNING id
                    """
                ),
                {"id": invite_id, "ws": admin.workspace_id},
            )
        ).fetchall()
        if not rows:
            raise not_found("That invitation is already used or gone.")
        await audit_service.record(
            session,
            actor_for(request, admin),
            "invite.revoked",
            target_type="invite",
            target_id=invite_id,
        )
    return OkOut()


# ─── channels ─────────────────────────────────────────────────────────────────
@router.get("/channels", response_model=AdminChannelsOut)
async def list_all_channels(admin: SessionUser = Depends(require_admin)) -> AdminChannelsOut:
    """Every channel, including private ones the admin is not a member of."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.kind, c.name, c.topic, c.created_by, c.created_at,
                           c.archived_at,
                           (SELECT count(*) FROM channel_members cm
                             WHERE cm.channel_id = c.id)::int AS member_count,
                           (SELECT count(*) FROM messages m
                             WHERE m.channel_id = c.id AND m.deleted_at IS NULL)::int
                             AS message_count,
                           (SELECT max(m.created_at) FROM messages m
                             WHERE m.channel_id = c.id) AS last_message_at
                      FROM channels c
                     WHERE c.workspace_id = :ws
                     ORDER BY c.kind, lower(c.name) NULLS LAST
                    """
                ),
                {"ws": admin.workspace_id},
            )
        ).fetchall()

    return AdminChannelsOut(
        channels=[
            AdminChannel(
                id=row.id,
                kind=row.kind,
                name=row.name,
                topic=row.topic,
                created_by=row.created_by,
                created_at=require_iso(row.created_at),
                archived_at=iso(row.archived_at),
                member_count=row.member_count,
                message_count=row.message_count,
                last_message_at=iso(row.last_message_at),
            )
            for row in rows
        ]
    )


@router.post("/channels/{channel_id}/archive", response_model=OkOut)
async def archive_any_channel(
    channel_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        rows = (
            await session.execute(
                text(
                    """
                    UPDATE channels SET archived_at = now()
                     WHERE id = :id AND workspace_id = :ws
                       AND kind IN ('public', 'private')
                    RETURNING id
                    """
                ),
                {"id": channel_id, "ws": admin.workspace_id},
            )
        ).fetchall()
        if not rows:
            raise not_found("That channel no longer exists.")
        await audit_service.record(
            session,
            actor_for(request, admin),
            "channel.archived",
            target_type="channel",
            target_id=channel_id,
        )
        after.add(
            lambda: hub.to_channel(channel_id, {"t": "channel.archived", "channelId": channel_id})
        )
    return OkOut()


# ─── audit log ────────────────────────────────────────────────────────────────
@router.get("/audit", response_model=AuditOut)
async def audit_log(
    actor_id: str | None = None,
    action: str | None = None,
    before: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    admin: SessionUser = Depends(require_admin),
) -> AuditOut:
    async with session_scope() as session:
        events = await audit_service.list_events(
            session,
            admin.workspace_id,
            actor_id=actor_id,
            action=action,
            before=before,
            limit=limit,
        )
    return AuditOut(events=events)


# ─── settings and health ──────────────────────────────────────────────────────
@router.get("/settings", response_model=WorkspaceSettingsOut)
async def get_settings(admin: SessionUser = Depends(require_admin)) -> WorkspaceSettingsOut:
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT w.name, w.slug, COALESCE(s.settings, '{}'::jsonb) AS settings
                      FROM workspaces w
                      LEFT JOIN workspace_settings s ON s.workspace_id = w.id
                     WHERE w.id = :ws
                    """
                ),
                {"ws": admin.workspace_id},
            )
        ).fetchone()
    if row is None:
        raise not_found("That workspace no longer exists.")
    return WorkspaceSettingsOut(name=row.name, slug=row.slug, settings=row.settings or {})


@router.patch("/settings", response_model=WorkspaceSettingsOut)
async def update_settings(
    payload: SettingsInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> WorkspaceSettingsOut:
    async with transaction() as (session, _):
        if payload.name:
            await session.execute(
                text("UPDATE workspaces SET name = :name WHERE id = :ws"),
                {"name": payload.name, "ws": admin.workspace_id},
            )
        if payload.settings is not None:
            # Settings merge rather than replace, matching how user prefs behave.
            await session.execute(
                text(
                    """
                    INSERT INTO workspace_settings (workspace_id, settings, updated_by)
                    VALUES (:ws, cast(:settings AS jsonb), :actor)
                    ON CONFLICT (workspace_id) DO UPDATE
                      SET settings = workspace_settings.settings || EXCLUDED.settings,
                          updated_at = now(),
                          updated_by = EXCLUDED.updated_by
                    """
                ),
                {
                    "ws": admin.workspace_id,
                    "settings": json.dumps(payload.settings),
                    "actor": admin.id,
                },
            )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "settings.updated",
            target_type="workspace",
            target_id=admin.workspace_id,
            metadata={"keys": sorted((payload.settings or {}).keys())},
        )
        row = (
            await session.execute(
                text(
                    """
                    SELECT w.name, w.slug, COALESCE(s.settings, '{}'::jsonb) AS settings
                      FROM workspaces w
                      LEFT JOIN workspace_settings s ON s.workspace_id = w.id
                     WHERE w.id = :ws
                    """
                ),
                {"ws": admin.workspace_id},
            )
        ).fetchone()
    if row is None:
        raise not_found("That workspace no longer exists.")
    return WorkspaceSettingsOut(name=row.name, slug=row.slug, settings=row.settings or {})


@router.get("/health", response_model=HealthOut)
async def health(admin: SessionUser = Depends(require_admin)) -> HealthOut:
    database = True
    counts = {"messages": 0, "storage": 0}
    try:
        async with session_scope() as session:
            row = (
                await session.execute(
                    text(
                        """
                        SELECT (SELECT count(*) FROM messages WHERE deleted_at IS NULL)::int
                                 AS messages,
                               (SELECT COALESCE(sum(size_bytes), 0) FROM attachments)::bigint
                                 AS storage
                        """
                    )
                )
            ).fetchone()
            if row:
                counts = {"messages": row.messages, "storage": int(row.storage)}
    except Exception:
        database = False

    redis_ok = True
    queue_depth = 0
    try:
        await redis.ping()
        queue_depth = await redis.zcard("arq:queue")
    except Exception:
        redis_ok = False

    stats = hub.stats()
    return HealthOut(
        database=database,
        redis=redis_ok,
        queue_depth=queue_depth,
        connections=stats["connections"],
        users_online=stats["users"],
        message_count=counts["messages"],
        storage_bytes=counts["storage"],
        version="0.1.0",
    )


# ─── webhooks ─────────────────────────────────────────────────────────────────
@router.get("/webhooks", response_model=WebhooksOut)
async def list_webhooks(admin: SessionUser = Depends(require_admin)) -> WebhooksOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, name, channel_id, created_at, last_used_at
                      FROM webhooks WHERE workspace_id = :ws ORDER BY id DESC
                    """
                ),
                {"ws": admin.workspace_id},
            )
        ).fetchall()
    return WebhooksOut(
        webhooks=[
            WebhookOut(
                id=row.id,
                name=row.name,
                channel_id=row.channel_id,
                created_at=require_iso(row.created_at),
                last_used_at=iso(row.last_used_at),
            )
            for row in rows
        ]
    )


@router.post("/webhooks", response_model=WebhookOut)
async def create_webhook(
    payload: CreateWebhookInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> WebhookOut:
    """The URL comes back once. The raw token is never recoverable afterwards."""
    from ..config import settings

    token = new_token()
    webhook_id = new_id()

    async with transaction() as (session, _):
        channel = (
            await session.execute(
                text("SELECT id FROM channels WHERE id = :id AND workspace_id = :ws"),
                {"id": payload.channel_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if channel is None:
            raise not_found("That channel no longer exists.")

        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO webhooks
                      (id, workspace_id, channel_id, name, token_hash, created_by)
                    VALUES (:id, :ws, :channel_id, :name, :token_hash, :created_by)
                    RETURNING created_at
                    """
                ),
                {
                    "id": webhook_id,
                    "ws": admin.workspace_id,
                    "channel_id": payload.channel_id,
                    "name": payload.name,
                    "token_hash": hash_token(token),
                    "created_by": admin.id,
                },
            )
        ).fetchone()
        await audit_service.record(
            session,
            actor_for(request, admin),
            "webhook.created",
            target_type="webhook",
            target_id=webhook_id,
            metadata={"name": payload.name},
        )

    return WebhookOut(
        id=webhook_id,
        name=payload.name,
        channel_id=payload.channel_id,
        created_at=require_iso(row.created_at) if row else require_iso_now(),
        last_used_at=None,
        url=f"{settings.PUBLIC_URL.rstrip('/')}/api/hooks/{token}",
    )


@router.delete("/webhooks/{webhook_id}", response_model=OkOut)
async def revoke_webhook(
    webhook_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _):
        rows = (
            await session.execute(
                text("DELETE FROM webhooks WHERE id = :id AND workspace_id = :ws RETURNING id"),
                {"id": webhook_id, "ws": admin.workspace_id},
            )
        ).fetchall()
        if not rows:
            raise not_found("That webhook is already gone.")
        await audit_service.record(
            session,
            actor_for(request, admin),
            "webhook.revoked",
            target_type="webhook",
            target_id=webhook_id,
        )
    return OkOut()


__all__ = ["router"]


# ─── the instance, across every workspace on it ───────────────────────────────
#
# Everything above this line is scoped to the caller's workspace, which is what an owner
# or admin running one workspace needs. These two are not: they answer "what is on this
# server", which is a different job and, once a server holds more than one workspace, a
# different person's.
#
# Gated on `instance_admins`, which is a fact about a *person* rather than a role inside
# one workspace — see migration 0011. `owner` stood in for this while there was only ever
# one workspace to own, and would have been the wrong answer the moment there were two.


class InstanceUser(CamelModel):
    id: str
    email: str
    display_name: str
    role: str
    kind: str
    workspace_id: str
    workspace_name: str
    deactivated: bool
    created_at: str


class InstanceUsersOut(CamelModel):
    users: list[InstanceUser]


class InstanceWorkspace(CamelModel):
    id: str
    name: str
    slug: str
    member_count: int
    channel_count: int
    app_count: int
    created_at: str


class InstanceWorkspacesOut(CamelModel):
    workspaces: list[InstanceWorkspace]


@router.get("/instance/users", response_model=InstanceUsersOut)
async def instance_users(
    _admin: SessionUser = Depends(require_instance_admin),
) -> InstanceUsersOut:
    """Every account on the server, whichever workspace it belongs to."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.email, u.display_name, u.role, u.kind,
                           u.workspace_id, w.name AS workspace_name,
                           u.deactivated_at, u.created_at
                      FROM users u
                      JOIN workspaces w ON w.id = u.workspace_id
                     ORDER BY w.name, lower(u.display_name)
                    """
                )
            )
        ).fetchall()

    return InstanceUsersOut(
        users=[
            InstanceUser(
                id=row.id,
                email=row.email,
                display_name=row.display_name,
                role=row.role,
                kind=row.kind,
                workspace_id=row.workspace_id,
                workspace_name=row.workspace_name,
                deactivated=row.deactivated_at is not None,
                created_at=iso(row.created_at) or "",
            )
            for row in rows
        ]
    )


@router.get("/instance/workspaces", response_model=InstanceWorkspacesOut)
async def instance_workspaces(
    _admin: SessionUser = Depends(require_instance_admin),
) -> InstanceWorkspacesOut:
    """Every workspace on the server, with enough to tell them apart at a glance.

    Counted in one pass with correlated subqueries rather than three joins and a GROUP BY:
    at the number of workspaces a self-hosted server holds, clarity is worth more than the
    query plan, and each count reads as the sentence it answers.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT w.id, w.name, w.slug, w.created_at,
                           (SELECT count(*) FROM users u
                             WHERE u.workspace_id = w.id
                               AND u.deactivated_at IS NULL) AS member_count,
                           (SELECT count(*) FROM channels c
                             WHERE c.workspace_id = w.id
                               AND c.kind IN ('public', 'private')) AS channel_count,
                           (SELECT count(*) FROM plugins p
                             WHERE p.workspace_id = w.id) AS app_count
                      FROM workspaces w
                     ORDER BY w.created_at
                    """
                )
            )
        ).fetchall()

    return InstanceWorkspacesOut(
        workspaces=[
            InstanceWorkspace(
                id=row.id,
                name=row.name,
                slug=row.slug,
                member_count=row.member_count,
                channel_count=row.channel_count,
                app_count=row.app_count,
                created_at=iso(row.created_at) or "",
            )
            for row in rows
        ]
    )


class CreateWorkspaceInput(CamelModel):
    name: str = Field(min_length=1, max_length=80)


class CreatedWorkspaceOut(CamelModel):
    id: str
    name: str
    slug: str


@router.post("/instance/workspaces", response_model=CreatedWorkspaceOut, status_code=201)
async def create_workspace(
    payload: CreateWorkspaceInput,
    request: Request,
    admin: SessionUser = Depends(require_instance_admin),
) -> CreatedWorkspaceOut:
    """Make another workspace, owned by whoever made it.

    The creator gets an owner account in it carrying the password they already have —
    `services/workspaces` keeps one address to one password across every row, so a new
    workspace never means a new credential to remember or a prompt to set one.

    They are not added to anyone else's workspace by this, and nobody else is added to
    theirs. A workspace starts with exactly one person in it, which is what an invitation
    is for.
    """
    async with transaction() as (session, _):
        password_hash = await workspace_service.password_hash_for(session, admin.email)
        founded = await workspace_service.found(
            session,
            name=payload.name,
            email=admin.email,
            display_name=admin.display_name,
            password_hash=password_hash,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "workspace.created",
            target_type="workspace",
            target_id=founded.workspace_id,
            metadata={"name": payload.name.strip(), "slug": founded.slug},
        )

    return CreatedWorkspaceOut(
        id=founded.workspace_id, name=payload.name.strip(), slug=founded.slug
    )
