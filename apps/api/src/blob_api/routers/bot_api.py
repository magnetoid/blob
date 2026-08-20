"""The callback API — what an installed app calls to do things.

Mounted at `/api/v1/` and versioned separately from the client's `/api/` surface,
because these two have different audiences and different rates of change. The client
ships with the server and can be changed in the same commit; an app is somebody else's
code on somebody else's schedule, and breaking it silently is not an option.

Method names follow Slack's `noun.verb` convention for the same reason the signing
scheme does: it is what the people writing these integrations already know.

Every write here goes through the same service functions the human endpoints use, so a
bot cannot reach a code path that skips mention parsing, thread bookkeeping or the
idempotency constraint.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..lib.queue import enqueue, fire_and_forget
from ..plugins import events as plugin_events
from ..plugins.auth import BotCaller, current_bot, requires
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import Channel, Message, User
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services.serialize import message_event, to_channel, to_user

router = APIRouter(prefix="/api/v1", tags=["apps"])

_CHANNEL_NAME_RE = re.compile(r"^#?([a-z0-9][a-z0-9._-]{0,79})$")


class AuthTestOut(CamelModel):
    ok: bool = True
    app: str
    slug: str
    user_id: str
    workspace_id: str
    scopes: list[str]


class PostMessageInput(CamelModel):
    #: A channel id, or a name like "#general". Names are convenient in a CI config
    #: where nobody wants to paste a UUID.
    channel: str
    text: str
    thread_root_id: str | None = None
    also_in_channel: bool = False
    #: Apps that retry should send the same value twice; the second call stores nothing.
    client_msg_id: str | None = None


class MessageOut(CamelModel):
    ok: bool = True
    message: Message


class EditMessageInput(CamelModel):
    message_id: str
    text: str


class DeleteMessageInput(CamelModel):
    message_id: str


class ReactionInput(CamelModel):
    message_id: str
    emoji: str


class JoinInput(CamelModel):
    channel: str


class OkOut(CamelModel):
    ok: bool = True


class ChannelsOut(CamelModel):
    ok: bool = True
    channels: list[Channel]


class UsersOut(CamelModel):
    ok: bool = True
    users: list[User]


async def _resolve_channel(session: Any, workspace_id: str, reference: str) -> str:
    """Accept either an id or a #name."""
    reference = reference.strip()
    if "-" in reference and len(reference) == 36:
        return reference

    match = _CHANNEL_NAME_RE.match(reference.lower())
    if not match:
        raise bad_request("That is not a channel id or name.", code="bad_channel")
    row = (
        await session.execute(
            text(
                """
                SELECT id FROM channels
                 WHERE workspace_id = :ws AND lower(name) = :name
                   AND kind IN ('public', 'private')
                """
            ),
            {"ws": workspace_id, "name": match.group(1)},
        )
    ).fetchone()
    if row is None:
        raise not_found("There is no channel by that name.")
    return str(row.id)


@router.get("/auth.test", response_model=AuthTestOut)
async def auth_test(bot: BotCaller = Depends(current_bot)) -> AuthTestOut:
    """Confirms a token works and says what it can do. The first call anyone makes."""
    return AuthTestOut(
        app=bot.name,
        slug=bot.slug,
        user_id=bot.user_id,
        workspace_id=bot.workspace_id,
        scopes=sorted(bot.scopes),
    )


@router.post("/chat.postMessage", response_model=MessageOut, status_code=201)
async def post_message(
    payload: PostMessageInput, bot: BotCaller = requires("messages:write")
) -> MessageOut:
    async with transaction() as (session, after):
        channel_id = await _resolve_channel(session, bot.workspace_id, payload.channel)
        # The bot's own access, checked the same way a person's would be.
        await channel_service.assert_channel_access(
            session, bot.user_id, channel_id, require_member=True, require_writable=True
        )
        result = await message_service.send(
            session,
            workspace_id=bot.workspace_id,
            channel_id=channel_id,
            author_id=bot.user_id,
            body=payload.text,
            client_msg_id=payload.client_msg_id or f"app-{new_id()}",
            thread_root_id=payload.thread_root_id,
            also_in_channel=payload.also_in_channel,
            kind="bot",
            plugin_id=bot.plugin_id,
        )

        if result.created:
            message = result.message
            thread_update = result.thread_update
            await plugin_events.emit(
                session,
                workspace_id=bot.workspace_id,
                event="message.created",
                payload=message.model_dump(by_alias=True),
                # Without this an app that posts on message.created answers itself
                # forever, at whatever rate the network allows.
                exclude_plugin_id=bot.plugin_id,
            )

            def broadcast() -> None:
                hub.to_channel(channel_id, message_event("message.new", message))
                if thread_update:
                    hub.to_channel(channel_id, thread_update.as_event())
                fire_and_forget(enqueue("notify", message.id))
                fire_and_forget(enqueue("deliver_plugin_events"))

            after.add(broadcast)

    return MessageOut(message=result.message)


@router.post("/chat.update", response_model=MessageOut)
async def update_message(
    payload: EditMessageInput, bot: BotCaller = requires("messages:write")
) -> MessageOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, payload.message_id)
        if existing is None:
            raise not_found("That message is gone.")
        # Editing someone else's message is a different, larger permission.
        if existing.author_id != bot.user_id and not bot.has("messages:moderate"):
            raise bad_request(
                "This app can only edit its own messages.", code="not_own_message"
            )
        await channel_service.assert_channel_access(
            session, bot.user_id, existing.channel_id, require_member=True
        )
        message = await message_service.edit(
            session,
            payload.message_id,
            existing.author_id or bot.user_id,
            bot.workspace_id,
            payload.text,
        )
        await plugin_events.emit(
            session,
            workspace_id=bot.workspace_id,
            event="message.updated",
            payload=message.model_dump(by_alias=True),
            exclude_plugin_id=bot.plugin_id,
        )

        def broadcast() -> None:
            hub.to_channel(message.channel_id, message_event("message.updated", message))
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)

    return MessageOut(message=message)


@router.post("/chat.delete", response_model=OkOut)
async def delete_message(
    payload: DeleteMessageInput, bot: BotCaller = requires("messages:write")
) -> OkOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, payload.message_id)
        if existing is None:
            raise not_found("That message is gone.")
        moderating = existing.author_id != bot.user_id
        if moderating and not bot.has("messages:moderate"):
            raise bad_request(
                "This app can only delete its own messages.", code="not_own_message"
            )
        await channel_service.assert_channel_access(
            session, bot.user_id, existing.channel_id, require_member=True
        )
        channel_id, thread_root_id = await message_service.remove(
            session, payload.message_id, existing.author_id or bot.user_id, moderating
        )
        message_id = payload.message_id
        await plugin_events.emit(
            session,
            workspace_id=bot.workspace_id,
            event="message.deleted",
            payload={"id": message_id, "channelId": channel_id},
            exclude_plugin_id=bot.plugin_id,
        )

        def broadcast() -> None:
            hub.to_channel(
                channel_id,
                {
                    "t": "message.deleted",
                    "id": message_id,
                    "channelId": channel_id,
                    "threadRootId": thread_root_id,
                },
            )
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)

    return OkOut()


@router.post("/reactions.add", response_model=OkOut)
async def add_reaction(
    payload: ReactionInput, bot: BotCaller = requires("reactions:write")
) -> OkOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, payload.message_id)
        if existing is None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(
            session, bot.user_id, existing.channel_id, require_member=True
        )
        added = await message_service.add_reaction(
            session, payload.message_id, bot.user_id, payload.emoji
        )
        if added:
            channel_id = existing.channel_id
            message_id = payload.message_id
            emoji = payload.emoji
            user_id = bot.user_id
            after.add(
                lambda: hub.to_channel(
                    channel_id,
                    {
                        "t": "reaction.added",
                        "messageId": message_id,
                        "emoji": emoji,
                        "userId": user_id,
                    },
                )
            )
    return OkOut()


@router.get("/conversations.list", response_model=ChannelsOut)
async def list_conversations(
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    bot: BotCaller = requires("channels:read"),
) -> ChannelsOut:
    """Channels this app can see: public ones, plus private ones it was invited to."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT c.*
                      FROM channels c
                      LEFT JOIN channel_members cm
                             ON cm.channel_id = c.id AND cm.user_id = :user_id
                     WHERE c.workspace_id = :ws
                       AND (c.kind = 'public' OR cm.user_id IS NOT NULL)
                       AND c.kind IN ('public', 'private')
                     ORDER BY c.name
                     LIMIT :limit
                    """
                ),
                {"ws": bot.workspace_id, "user_id": bot.user_id, "limit": limit},
            )
        ).fetchall()
    return ChannelsOut(channels=[to_channel(row) for row in rows])


@router.post("/conversations.join", response_model=OkOut)
async def join_conversation(
    payload: JoinInput, bot: BotCaller = requires("channels:join")
) -> OkOut:
    async with transaction() as (session, after):
        channel_id = await _resolve_channel(session, bot.workspace_id, payload.channel)
        # A private channel is invisible to a non-member, so this is a 404 rather than a
        # way to discover that it exists.
        await channel_service.assert_channel_access(session, bot.user_id, channel_id)
        await channel_service.join(session, channel_id, bot.user_id)
        await plugin_events.emit(
            session,
            workspace_id=bot.workspace_id,
            event="member.joined",
            payload={"channelId": channel_id, "userId": bot.user_id},
            exclude_plugin_id=bot.plugin_id,
        )
        after.add(lambda: fire_and_forget(enqueue("deliver_plugin_events")))
    return OkOut()


@router.get("/users.list", response_model=UsersOut)
async def list_users(bot: BotCaller = requires("users:read")) -> UsersOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT * FROM users
                     WHERE workspace_id = :ws AND deactivated_at IS NULL
                     ORDER BY display_name
                    """
                ),
                {"ws": bot.workspace_id},
            )
        ).fetchall()
    # to_user omits email by design; users:read.email is a separate endpoint's problem.
    return UsersOut(users=[to_user(row) for row in rows])


__all__ = ["router"]
