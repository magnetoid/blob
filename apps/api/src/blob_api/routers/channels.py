"""Channels, membership, and DM creation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import forbidden, not_found
from ..lib.queue import enqueue, fire_and_forget
from ..plugins import events as plugin_events
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import ChannelWithState, Message
from ..schemas.requests import (
    AddMembersInput,
    CreateChannelInput,
    CreateDmInput,
    MembershipUpdateInput,
    UpdateChannelInput,
)
from ..services import channels as channel_service
from ..services import messages as message_service

router = APIRouter(tags=["channels"])


class ChannelsOut(CamelModel):
    channels: list[ChannelWithState]


class ChannelOut(CamelModel):
    channel: ChannelWithState | None = None


class MembersOut(CamelModel):
    user_ids: list[str]


class MessagesOut(CamelModel):
    messages: list[Message]


class OkOut(CamelModel):
    ok: bool = True


def _channel_event(name: str, channel: ChannelWithState) -> dict[str, Any]:
    return {"t": name, "channel": channel.model_dump(by_alias=True)}


@router.get("/api/channels", response_model=ChannelsOut)
async def list_channels(user: SessionUser = Depends(current_user)) -> ChannelsOut:
    async with session_scope() as session:
        channels = await channel_service.list_for_user(session, user.id, user.workspace_id)
    return ChannelsOut(channels=channels)


@router.post("/api/channels", response_model=ChannelOut)
async def create_channel(
    payload: CreateChannelInput, user: SessionUser = Depends(current_user)
) -> ChannelOut:
    async with transaction() as (session, after):
        channel_id = await channel_service.create_channel(
            session,
            workspace_id=user.workspace_id,
            created_by=user.id,
            name=payload.name,
            kind=payload.kind,
            topic=payload.topic,
            description=payload.description,
            extra_member_ids=payload.member_ids,
        )
        channel = await channel_service.get_for_user(session, channel_id, user.id)
        if channel is None:
            raise not_found("Could not create that channel.")
        members = await channel_service.member_ids(session, channel_id)
        # Catalogued in every app's manifest since the beginning; emitted since now.
        # Scoped by channel, so a private channel is announced only to apps invited in.
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="channel.created",
            channel_id=channel_id,
            payload={"channelId": channel_id, "name": payload.name, "kind": payload.kind},
        )

        def broadcast() -> None:
            # Public channels appear in everyone's browser; private ones only for members.
            if payload.kind == "public":
                hub.to_workspace(user.workspace_id, _channel_event("channel.created", channel))
            else:
                hub.to_users(members, _channel_event("channel.created", channel))
            hub.subscribe_users(members, [channel_id])
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)

    return ChannelOut(channel=channel)


@router.get("/api/channels/{channel_id}", response_model=ChannelOut)
async def get_channel(channel_id: str, user: SessionUser = Depends(current_user)) -> ChannelOut:
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        channel = await channel_service.get_for_user(session, channel_id, user.id)
    if channel is None:
        raise not_found("That channel no longer exists.")
    return ChannelOut(channel=channel)


@router.patch("/api/channels/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: str,
    payload: UpdateChannelInput,
    user: SessionUser = Depends(current_user),
) -> ChannelOut:
    given = payload.model_fields_set

    async with transaction() as (session, after):
        access = await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True, require_writable=True
        )
        if access.kind in ("dm", "group_dm"):
            raise forbidden("Direct messages have no channel settings.")

        await session.execute(
            text(
                """
                UPDATE channels
                   SET name = COALESCE(:name, name),
                       topic = CASE WHEN :has_topic THEN :topic ELSE topic END,
                       description = CASE WHEN :has_description THEN :description
                                          ELSE description END
                 WHERE id = :id
                """
            ),
            {
                "id": channel_id,
                "name": payload.name,
                "has_topic": "topic" in given,
                "topic": payload.topic,
                "has_description": "description" in given,
                "description": payload.description,
            },
        )
        channel = await channel_service.get_for_user(session, channel_id, user.id)
        if channel is not None:
            after.add(
                lambda: hub.to_channel(channel_id, _channel_event("channel.updated", channel))
            )

    return ChannelOut(channel=channel)


@router.post("/api/channels/{channel_id}/archive", response_model=OkOut)
async def archive_channel(channel_id: str, user: SessionUser = Depends(current_user)) -> OkOut:
    async with transaction() as (session, after):
        access = await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        if access.kind in ("dm", "group_dm"):
            raise forbidden("Direct messages cannot be archived.")

        await session.execute(
            text("UPDATE channels SET archived_at = now() WHERE id = :id"), {"id": channel_id}
        )
        after.add(
            lambda: hub.to_channel(channel_id, {"t": "channel.archived", "channelId": channel_id})
        )
    return OkOut()


@router.post("/api/channels/{channel_id}/join", response_model=ChannelOut)
async def join_channel(channel_id: str, user: SessionUser = Depends(current_user)) -> ChannelOut:
    async with transaction() as (session, after):
        access = await channel_service.assert_channel_access(
            session, user.id, channel_id, require_writable=True
        )
        if access.kind != "public":
            raise forbidden("That channel is invitation-only.")

        await channel_service.join(session, channel_id, user.id)
        channel = await channel_service.get_for_user(session, channel_id, user.id)
        # People joining were never announced to apps — only bots were (bot_api), so an
        # app subscribed to the catalogued member.joined heard about robots and nobody
        # else. Same event, same scoping, the missing half of the population.
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="member.joined",
            channel_id=channel_id,
            payload={"channelId": channel_id, "userId": user.id},
        )

        def broadcast() -> None:
            hub.to_channel(
                channel_id, {"t": "member.joined", "channelId": channel_id, "userId": user.id}
            )
            # Existing sockets need to start receiving the channel's events —
            # wherever they are held; the join may have landed on a sibling process.
            hub.subscribe_users([user.id], [channel_id])
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)

    return ChannelOut(channel=channel)


@router.post("/api/channels/{channel_id}/leave", response_model=OkOut)
async def leave_channel(channel_id: str, user: SessionUser = Depends(current_user)) -> OkOut:
    async with transaction() as (session, after):
        access = await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        if access.kind in ("dm", "group_dm"):
            raise forbidden("You cannot leave a direct message.")

        await channel_service.leave(session, channel_id, user.id)
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="member.left",
            channel_id=channel_id,
            payload={"channelId": channel_id, "userId": user.id},
        )

        def broadcast() -> None:
            hub.unsubscribe_users([user.id], [channel_id])
            hub.to_channel(
                channel_id, {"t": "member.left", "channelId": channel_id, "userId": user.id}
            )
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)
    return OkOut()


@router.post("/api/channels/{channel_id}/members", response_model=OkOut)
async def add_members(
    channel_id: str, payload: AddMembersInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, after):
        access = await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True, require_writable=True
        )
        if access.kind in ("dm", "group_dm"):
            raise forbidden("Start a new group message instead of adding people to this one.")

        await channel_service.add_members(session, channel_id, payload.user_ids)
        for member_id in payload.user_ids:
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="member.joined",
                channel_id=channel_id,
                payload={"channelId": channel_id, "userId": member_id},
            )
        views = {
            member_id: await channel_service.get_for_user(session, channel_id, member_id)
            for member_id in payload.user_ids
        }

        def broadcast() -> None:
            for member_id, view in views.items():
                hub.to_channel(
                    channel_id,
                    {"t": "member.joined", "channelId": channel_id, "userId": member_id},
                )
                hub.subscribe_users([member_id], [channel_id])
                if view is not None:
                    hub.to_users([member_id], _channel_event("channel.created", view))
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)
    return OkOut()


@router.get("/api/channels/{channel_id}/members", response_model=MembersOut)
async def list_members(channel_id: str, user: SessionUser = Depends(current_user)) -> MembersOut:
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        ids = await channel_service.member_ids(session, channel_id)
    return MembersOut(user_ids=ids)


@router.patch("/api/channels/{channel_id}/membership", response_model=ChannelOut)
async def update_membership(
    channel_id: str,
    payload: MembershipUpdateInput,
    user: SessionUser = Depends(current_user),
) -> ChannelOut:
    """Per-user channel settings: notification level and starring."""
    async with transaction() as (session, after):
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        await session.execute(
            text(
                """
                UPDATE channel_members
                   SET notify_level = COALESCE(:notify_level, notify_level),
                       is_starred   = COALESCE(:is_starred, is_starred)
                 WHERE channel_id = :channel_id AND user_id = :user_id
                """
            ),
            {
                "channel_id": channel_id,
                "user_id": user.id,
                "notify_level": payload.notify_level,
                "is_starred": payload.is_starred,
            },
        )
        channel = await channel_service.get_for_user(session, channel_id, user.id)
        if channel is not None:
            after.add(lambda: hub.to_users([user.id], _channel_event("channel.updated", channel)))
    return ChannelOut(channel=channel)


@router.get("/api/channels/{channel_id}/pins", response_model=MessagesOut)
async def list_pins(channel_id: str, user: SessionUser = Depends(current_user)) -> MessagesOut:
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        messages = await message_service.list_pinned(session, channel_id)
    return MessagesOut(messages=messages)


@router.post("/api/dms", response_model=ChannelOut)
async def open_dm(payload: CreateDmInput, user: SessionUser = Depends(current_user)) -> ChannelOut:
    """Open (or reopen) a DM. Idempotent: the same member set returns the same channel."""
    members = list(dict.fromkeys([user.id, *payload.user_ids]))

    async with transaction() as (session, after):
        valid = (
            await session.execute(
                text(
                    """
                    SELECT count(*)::int AS count FROM users
                     WHERE id = ANY(cast(:ids AS uuid[]))
                       AND workspace_id = :ws
                       AND deactivated_at IS NULL
                    """
                ),
                {"ids": members, "ws": user.workspace_id},
            )
        ).fetchone()
        if (valid.count if valid else 0) != len(members):
            raise not_found("One of those people is unavailable.")

        channel_id, created = await channel_service.find_or_create_dm(
            session, user.workspace_id, members
        )
        channel = await channel_service.get_for_user(session, channel_id, user.id)

        if created:
            views = {
                member_id: await channel_service.get_for_user(session, channel_id, member_id)
                for member_id in members
            }

            def broadcast() -> None:
                for member_id, view in views.items():
                    hub.subscribe_users([member_id], [channel_id])
                    if view is not None:
                        hub.to_users([member_id], _channel_event("channel.created", view))

            after.add(broadcast)

    return ChannelOut(channel=channel)


__all__ = ["router"]
