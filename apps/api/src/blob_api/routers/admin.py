"""The superadmin console.

Every mutation here writes an audit row and, where it changes something the client
renders, broadcasts so open sessions update without a refresh.

`owner` is a real role rather than "the admin who signed up first": exactly one exists,
only an owner changes roles, and the last owner cannot be demoted or deactivated.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import (
    SessionUser,
    hash_token,
    require_admin,
    require_owner,
)
from ..lib.errors import bad_request, conflict, not_found, unique_violation
from ..lib.ids import IdParam, new_id, new_token
from ..lib.redis import redis
from ..realtime import hub
from ..schemas.base import CamelModel, iso, require_iso
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import handles as handle_service
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
    user_id: IdParam,
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
                hub.to_workspace(
                    owner.workspace_id,
                    {"t": "user.updated", "user": updated.model_dump(by_alias=True)},
                )

        after.add(broadcast_roles)

    return OkOut()


@router.post("/users/{user_id}/deactivate", response_model=OkOut)
async def deactivate(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
        # The display-name index is partial on `deactivated_at IS NULL`, so deactivating
        # already frees the name. The handle table has to be told, or it would hold a
        # departed account's name against everybody for ever — the exact hostage problem
        # the partial index exists to prevent.
        await handle_service.release_user(session, user_id)
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
            hub.close_users([user_id])
            if updated is not None:
                hub.to_workspace(
                    admin.workspace_id,
                    {"t": "user.updated", "user": updated.model_dump(by_alias=True)},
                )

        after.add(broadcast)

    return OkOut()


@router.post("/users/{user_id}/reactivate", response_model=OkOut)
async def reactivate(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        # Re-claiming the handle is the check. It replaces a probe that read `users`
        # and only `users`, which could not see a *group* that had taken the name in the
        # meantime — the collision no index spanning one table can catch.
        name = (
            await session.execute(
                text("SELECT display_name FROM users WHERE id = :id AND workspace_id = :ws"),
                {"id": user_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if name is None:
            raise not_found("There is no such person here.")
        try:
            await handle_service.claim(
                session, admin.workspace_id, name.display_name, user_id=user_id
            )
        except Exception as exc:
            if unique_violation(exc):
                raise conflict(
                    "That display name is taken now. Rename whoever holds it first.",
                    "name_taken",
                ) from exc
            raise

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
                lambda: hub.to_workspace(
                    admin.workspace_id,
                    {"t": "user.updated", "user": updated.model_dump(by_alias=True)},
                )
            )

    return OkOut()


@router.post("/users/{user_id}/revoke-sessions", response_model=OkOut)
async def revoke_sessions(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Sign someone out of every device without disabling their account."""
    async with transaction() as (session, after):
        # The workspace check must precede the delete: an admin's reach ends at their
        # own workspace, and a bare user id would let them sign out anyone on the server.
        target = (
            await session.execute(
                text("SELECT 1 FROM users WHERE id = :id AND workspace_id = :ws"),
                {"id": user_id, "ws": admin.workspace_id},
            )
        ).fetchone()
        if target is None:
            raise not_found("There is no such person here.")
        await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
        await audit_service.record(
            session,
            actor_for(request, admin),
            "user.sessions_revoked",
            target_type="user",
            target_id=user_id,
        )

        def disconnect() -> None:
            hub.close_users([user_id])

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

    return require_iso(datetime.now(UTC))


@router.delete("/invites/{invite_id}", response_model=OkOut)
async def revoke_invite(
    invite_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
                     ORDER BY c.kind, lower(c.name) NULLS LAST LIMIT 1000
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
    channel_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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

@router.post("/channels/{channel_id}/unarchive", response_model=OkOut)
async def unarchive_any_channel(
    channel_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Reopen an archived channel.

    Archiving had no undo anywhere: no route, no command, no console button, and nothing
    in the repository that set `archived_at` back to null. The history was intact the
    whole time and simply unreachable for writing, which made a reversible decision
    permanent by omission.
    """
    async with transaction() as (session, after):
        rows = (
            await session.execute(
                text(
                    """
                    UPDATE channels SET archived_at = NULL
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
            "channel.unarchived",
            target_type="channel",
            target_id=channel_id,
        )
        # The same event a rename sends: clients hold channels by id and re-read the row,
        # so "it is not archived any more" needs no event of its own.
        channel = await channel_service.get_for_user(session, channel_id, admin.id)
        if channel is not None:
            payload = {"t": "channel.updated", "channel": channel.model_dump(by_alias=True)}
            after.add(lambda: hub.to_channel(channel_id, payload))
    return OkOut()
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
                        SELECT (SELECT count(*) FROM messages
                                  WHERE workspace_id = :ws AND deleted_at IS NULL)::int
                                 AS messages,
                               (SELECT COALESCE(sum(size_bytes), 0) FROM attachments
                                  WHERE workspace_id = :ws)::bigint
                                 AS storage
                        """
                    ),
                    {"ws": admin.workspace_id},
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

    stats = hub.stats(admin.workspace_id)
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
                      FROM webhooks WHERE workspace_id = :ws ORDER BY id DESC LIMIT 500
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
    webhook_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
