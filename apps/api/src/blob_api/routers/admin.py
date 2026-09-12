"""The workspace console.

Shape and authorize; `services/admin.py` holds the SQL and writes the audit rows. What
is left here is what a route is for: who may call it, and who is told afterwards —
every `after.add` below runs past COMMIT, so no session hears about a row that did not
commit (ADR 0004).

`owner` is a real role rather than "the admin who signed up first": exactly one exists,
only an owner changes roles, and the last owner cannot be demoted or deactivated.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import mail, storage
from ..lib.auth import SessionUser, require_admin, require_owner
from ..lib.ids import IdParam
from ..lib.redis import redis
from ..realtime import hub
from ..schemas.admin import (
    AdminChannelsOut,
    AdminDeliveriesOut,
    AdminInvitesOut,
    AdminUsersOut,
    CreateWebhookInput,
    HealthOut,
    ResetLinkOut,
    RoleInput,
    SettingsInput,
    WebhookOut,
    WebhooksOut,
    WorkspaceSettingsOut,
)
from ..schemas.base import CamelModel, OkOut
from ..schemas.models import User
from ..services import admin as admin_service
from ..services import audit as audit_service
from ..services.audit import AuditEntry, actor_for
from ..services.serialize import channel_event

router = APIRouter(tags=["admin"], prefix="/api/admin")


class AuditOut(CamelModel):
    events: list[AuditEntry]


def _user_updated(workspace_id: str, user: User) -> None:
    hub.to_workspace(workspace_id, {"t": "user.updated", "user": user.model_dump(by_alias=True)})


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
        return await admin_service.list_users(
            session,
            admin.workspace_id,
            q=q,
            include_deactivated=include_deactivated,
            limit=limit,
            offset=offset,
        )


@router.put("/users/{user_id}/role", response_model=OkOut)
async def set_role(
    user_id: IdParam,
    payload: RoleInput,
    request: Request,
    owner: SessionUser = Depends(require_owner),
) -> OkOut:
    async with transaction() as (session, after):
        updates = await admin_service.set_role(
            session, actor_for(request, owner), user_id, payload.role
        )

        def broadcast_roles() -> None:
            for updated in updates:
                _user_updated(owner.workspace_id, updated)

        after.add(broadcast_roles)
    return OkOut()


@router.post("/users/{user_id}/deactivate", response_model=OkOut)
async def deactivate(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        updated = await admin_service.deactivate(session, actor_for(request, admin), user_id)

        def broadcast() -> None:
            hub.close_users([user_id])
            if updated is not None:
                _user_updated(admin.workspace_id, updated)

        after.add(broadcast)
    return OkOut()


@router.post("/users/{user_id}/reactivate", response_model=OkOut)
async def reactivate(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        updated = await admin_service.reactivate(session, actor_for(request, admin), user_id)
        if updated is not None:
            after.add(lambda: _user_updated(admin.workspace_id, updated))
    return OkOut()


@router.post("/users/{user_id}/revoke-sessions", response_model=OkOut)
async def revoke_sessions(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Sign someone out of every device without disabling their account."""
    async with transaction() as (session, after):
        await admin_service.revoke_sessions(session, actor_for(request, admin), user_id)
        after.add(lambda: hub.close_users([user_id]))
    return OkOut()


@router.post("/users/{user_id}/reset-link", response_model=ResetLinkOut)
async def create_reset_link(
    user_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> ResetLinkOut:
    """Mint a password-reset link for somebody, for an admin to hand over."""
    async with transaction() as (session, _):
        return await admin_service.create_reset_link(session, actor_for(request, admin), user_id)


# ─── invitations ──────────────────────────────────────────────────────────────
@router.get("/invites", response_model=AdminInvitesOut)
async def list_invites(admin: SessionUser = Depends(require_admin)) -> AdminInvitesOut:
    async with session_scope() as session:
        return await admin_service.list_invites(session, admin.workspace_id)


@router.delete("/invites/{invite_id}", response_model=OkOut)
async def revoke_invite(
    invite_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _):
        await admin_service.revoke_invite(session, actor_for(request, admin), invite_id)
    return OkOut()


# ─── channels ─────────────────────────────────────────────────────────────────
@router.get("/channels", response_model=AdminChannelsOut)
async def list_all_channels(admin: SessionUser = Depends(require_admin)) -> AdminChannelsOut:
    """Every channel, including private ones the admin is not a member of."""
    async with session_scope() as session:
        return await admin_service.list_channels(session, admin.workspace_id)


@router.post("/channels/{channel_id}/archive", response_model=OkOut)
async def archive_any_channel(
    channel_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        await admin_service.archive_channel(session, actor_for(request, admin), channel_id)
        after.add(
            lambda: hub.to_channel(channel_id, {"t": "channel.archived", "channelId": channel_id})
        )
    return OkOut()


@router.post("/channels/{channel_id}/unarchive", response_model=OkOut)
async def unarchive_any_channel(
    channel_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Reopen an archived channel."""
    async with transaction() as (session, after):
        channel = await admin_service.unarchive_channel(
            session, actor_for(request, admin), channel_id
        )
        # The same event a rename sends: clients hold channels by id and re-read the row,
        # so "it is not archived any more" needs no event of its own. The frame carries
        # the channel and nothing about anybody's standing in it — see `channel_event`.
        if channel is not None:
            payload = channel_event("channel.updated", channel)
            after.add(lambda: hub.to_channel(channel_id, payload))
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
        return await admin_service.get_settings(session, admin.workspace_id)


@router.patch("/settings", response_model=WorkspaceSettingsOut)
async def update_settings(
    payload: SettingsInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> WorkspaceSettingsOut:
    async with transaction() as (session, _):
        return await admin_service.update_settings(session, actor_for(request, admin), payload)


@router.get("/deliveries", response_model=AdminDeliveriesOut)
async def list_workspace_deliveries(
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    admin: SessionUser = Depends(require_admin),
) -> AdminDeliveriesOut:
    """Every app's recent deliveries, for the console log."""
    async with session_scope() as session:
        return await admin_service.list_deliveries(session, admin.workspace_id, limit=limit)


@router.get("/health", response_model=HealthOut)
async def health(admin: SessionUser = Depends(require_admin)) -> HealthOut:
    """Each dependency probed on its own, so one being down does not hide the others."""
    database = True
    messages, storage_bytes = 0, 0
    try:
        async with session_scope() as session:
            messages, storage_bytes = await admin_service.usage_counts(session, admin.workspace_id)
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
        mail=await mail.probe(),
        push=settings.push_enabled,
        storage=await storage.probe(),
        queue_depth=queue_depth,
        connections=stats["connections"],
        users_online=stats["users"],
        message_count=messages,
        storage_bytes=storage_bytes,
        version="0.1.0",
    )


# ─── webhooks ─────────────────────────────────────────────────────────────────
@router.get("/webhooks", response_model=WebhooksOut)
async def list_webhooks(admin: SessionUser = Depends(require_admin)) -> WebhooksOut:
    async with session_scope() as session:
        return await admin_service.list_webhooks(session, admin.workspace_id)


@router.post("/webhooks", response_model=WebhookOut)
async def create_webhook(
    payload: CreateWebhookInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> WebhookOut:
    """The URL comes back once. The raw token is never recoverable afterwards."""
    async with transaction() as (session, _):
        return await admin_service.create_webhook(session, actor_for(request, admin), payload)


@router.delete("/webhooks/{webhook_id}", response_model=OkOut)
async def revoke_webhook(
    webhook_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _):
        await admin_service.revoke_webhook(session, actor_for(request, admin), webhook_id)
    return OkOut()


__all__ = ["router"]
