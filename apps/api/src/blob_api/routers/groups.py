"""User groups — `@platform-team`.

Two routers, because two different people are being authorised. Managing a group is a
workspace admin's job; muting one is your own, and needs no more than membership.

Every statement carries `WHERE workspace_id = :ws` from the session rather than trusting
the id in the path — the dependency says *whether* you are an admin, the SQL says *of
what*. A group id belonging to another workspace answers 404, never 403, which is the
posture private channels already take: whether it exists is not the caller's business.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.errors import conflict, not_found, unique_violation
from ..lib.ids import IdParam
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import UserGroup
from ..schemas.requests import CreateGroupInput, MuteGroupInput, UpdateGroupInput
from ..services import audit as audit_service
from ..services import user_groups as group_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/groups")
member_router = APIRouter(tags=["groups"], prefix="/api/groups")


class GroupsOut(CamelModel):
    groups: list[UserGroup]


class GroupOut(CamelModel):
    group: UserGroup


class MembersOut(CamelModel):
    user_ids: list[IdParam]


class OkOut(CamelModel):
    ok: bool = True


def _out(group: group_service.Group) -> UserGroup:
    return UserGroup(
        id=group.id,
        handle=group.handle,
        name=group.name,
        description=group.description,
        member_count=group.member_count,
    )


def _upserted(workspace_id: str, group: UserGroup) -> None:
    hub.to_workspace(
        workspace_id, {"t": "group.upserted", "group": group.model_dump(by_alias=True)}
    )


def _membership(user_id: str, group_id: str, is_member: bool) -> None:
    """Only to the person it is about.

    "Are you in this group" cannot ride the shared payload — it is a different answer for
    every reader, and putting it on the group would mean broadcasting the roster.
    """
    hub.to_users([user_id], {"t": "group.membership", "groupId": group_id, "isMember": is_member})


@router.get("", response_model=GroupsOut)
async def list_groups(admin: SessionUser = Depends(require_admin)) -> GroupsOut:
    async with session_scope() as session:
        groups = await group_service.list_for_workspace(session, admin.workspace_id)
    return GroupsOut(groups=[_out(g) for g in groups])


@router.post("", response_model=GroupOut, status_code=201)
async def create_group(
    payload: CreateGroupInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> GroupOut:
    handle = group_service.clean_handle(payload.handle)
    async with transaction() as (session, after):
        try:
            group_id = await group_service.create(
                session,
                workspace_id=admin.workspace_id,
                handle=handle,
                name=payload.name,
                description=payload.description,
                created_by=admin.id,
            )
        except Exception as exc:
            if unique_violation(exc):
                # Taken by a person or by another group, indistinguishably — which is
                # the point of one namespace, and why the message does not say which.
                raise conflict(f"“{handle}” is already taken here.", "name_taken") from exc
            raise
        await audit_service.record(
            session,
            actor_for(request, admin),
            "group.created",
            target_type="group",
            target_id=group_id,
            # The audit query only LEFT JOINs labels for users and channels, so without
            # this the row reads as a bare verb with an opaque id beside it.
            metadata={"handle": handle, "name": payload.name},
        )
        group = await group_service.by_id(session, admin.workspace_id, group_id)
        if group is not None:
            out = _out(group)
            after.add(lambda: _upserted(admin.workspace_id, out))
    if group is None:
        raise not_found("There is no such group here.")
    return GroupOut(group=_out(group))


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: IdParam,
    payload: UpdateGroupInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> GroupOut:
    handle = group_service.clean_handle(payload.handle) if payload.handle is not None else None
    async with transaction() as (session, after):
        try:
            await group_service.rename(
                session,
                workspace_id=admin.workspace_id,
                group_id=group_id,
                handle=handle,
                name=payload.name,
                description=payload.description,
                touch_description="description" in payload.model_fields_set,
            )
        except Exception as exc:
            if unique_violation(exc):
                raise conflict("That handle is already taken here.", "name_taken") from exc
            raise
        await audit_service.record(
            session,
            actor_for(request, admin),
            "group.renamed",
            target_type="group",
            target_id=group_id,
            metadata={"handle": handle or "", "name": payload.name or ""},
        )
        group = await group_service.by_id(session, admin.workspace_id, group_id)
        if group is not None:
            out = _out(group)
            after.add(lambda: _upserted(admin.workspace_id, out))
    if group is None:
        raise not_found("There is no such group here.")
    return GroupOut(group=_out(group))


@router.delete("/{group_id}", response_model=OkOut)
async def delete_group(
    group_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, after):
        await group_service.delete(session, admin.workspace_id, group_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "group.deleted",
            target_type="group",
            target_id=group_id,
        )
        after.add(
            lambda: hub.to_workspace(
                admin.workspace_id, {"t": "group.deleted", "groupId": group_id}
            )
        )
    return OkOut()


@router.get("/{group_id}/members", response_model=MembersOut)
async def list_members(
    group_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> MembersOut:
    async with session_scope() as session:
        if not await group_service.exists(session, admin.workspace_id, group_id):
            raise not_found("There is no such group here.")
        ids = await group_service.member_ids(session, group_id)
    return MembersOut(user_ids=ids)


@router.put("/{group_id}/members/{user_id}", response_model=OkOut)
async def add_member(
    group_id: IdParam,
    user_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    async with transaction() as (session, after):
        await group_service.add_member(session, admin.workspace_id, group_id, user_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "group.member_added",
            target_type="group",
            target_id=group_id,
            metadata={"userId": user_id},
        )
        group = await group_service.by_id(session, admin.workspace_id, group_id)
        if group is not None:
            out = _out(group)
            after.add(lambda: _upserted(admin.workspace_id, out))
        after.add(lambda: _membership(user_id, group_id, True))
    return OkOut()


@router.delete("/{group_id}/members/{user_id}", response_model=OkOut)
async def remove_member(
    group_id: IdParam,
    user_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    async with transaction() as (session, after):
        await group_service.remove_member(session, admin.workspace_id, group_id, user_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "group.member_removed",
            target_type="group",
            target_id=group_id,
            metadata={"userId": user_id},
        )
        group = await group_service.by_id(session, admin.workspace_id, group_id)
        if group is not None:
            out = _out(group)
            after.add(lambda: _upserted(admin.workspace_id, out))
        after.add(lambda: _membership(user_id, group_id, False))
    return OkOut()


@member_router.put("/{group_id}/mute", response_model=OkOut)
async def set_mute(
    group_id: str, payload: MuteGroupInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Your own switch, for a group you are in.

    Separate from muting the channel and deliberately weaker: `notify.decide`
    short-circuits on a muted channel before any mention test runs, so silencing a group
    you are on is an *additional* opt-out rather than a way to reorder that.
    """
    # No broadcast: muting is your own state, and the only client that needs to know is
    # the one that just set it and is holding the response.
    async with transaction() as (session, _):
        if not await group_service.set_muted(session, group_id, user.id, payload.muted):
            # Not a member, or no such group. 404 for both: which of the two it is would
            # tell somebody whether a group they cannot see exists.
            raise not_found("You are not in that group.")
    return OkOut()


__all__ = ["member_router", "router"]
