"""Message endpoints.

Note the shape of every write: do the database work, let it commit, *then* broadcast and
enqueue. Nothing in this file emits inside a transaction.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Coroutine
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, hash_token
from ..lib.errors import forbidden, not_found
from ..lib.ids import new_id
from ..lib.queue import enqueue
from ..lib.rate_limit import consume
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import Message, ReadStateOut
from ..schemas.requests import (
    EditMessageInput,
    MarkReadInput,
    PinInput,
    ReactionInput,
    SendMessageInput,
    WebhookPostInput,
)
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import read_state as read_state_service

router = APIRouter(tags=["messages"])

URL_RE = re.compile(r"https?://")


class HistoryOut(CamelModel):
    messages: list[Message]
    has_more: bool


class MessagesOut(CamelModel):
    messages: list[Message]


class MessageOut(CamelModel):
    message: Message


class ReadStateResponse(CamelModel):
    read_state: ReadStateOut


class ReadStatesOut(CamelModel):
    read_states: list[ReadStateOut]
    total_mentions: int


class OkOut(CamelModel):
    ok: bool = True


_pending: set[asyncio.Task[None]] = set()


def _message_event(name: str, message: Message) -> dict[str, Any]:
    return {"t": name, "message": message.model_dump(by_alias=True)}


def _schedule(coro: Coroutine[Any, Any, None]) -> None:
    """Fire an enqueue without awaiting it, keeping a reference so it is not collected."""
    task = asyncio.create_task(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


@router.get("/api/channels/{channel_id}/messages", response_model=HistoryOut)
async def get_history(
    channel_id: str,
    before: str | None = None,
    after: str | None = None,
    around: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    user: SessionUser = Depends(current_user),
) -> HistoryOut:
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        messages, has_more = await message_service.history(
            session, channel_id, before=before, after=after, around=around, limit=limit
        )
    return HistoryOut(messages=messages, has_more=has_more)


@router.post("/api/channels/{channel_id}/messages", response_model=MessageOut)
async def send_message(
    channel_id: str,
    payload: SendMessageInput,
    response: Response,
    user: SessionUser = Depends(current_user),
) -> MessageOut:
    await consume("send_message", user.id)

    async with transaction() as (session, after_commit):
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True, require_writable=True
        )
        result = await message_service.send(
            session,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            author_id=user.id,
            body=payload.body,
            client_msg_id=payload.client_msg_id,
            thread_root_id=payload.thread_root_id,
            also_in_channel=payload.also_in_channel,
            attachment_ids=payload.attachment_ids,
        )

        # Retries of the same client_msg_id return the stored row and broadcast nothing.
        if result.created:

            def broadcast() -> None:
                hub.to_channel(channel_id, _message_event("message.new", result.message))
                if result.thread_update:
                    hub.to_channel(channel_id, result.thread_update.as_event())
                _schedule(enqueue("notify", result.message.id))
                if URL_RE.search(payload.body):
                    _schedule(enqueue("unfurl", result.message.id))

            after_commit.add(broadcast)

    response.status_code = 201 if result.created else 200
    return MessageOut(message=result.message)


@router.get("/api/messages/{message_id}/thread", response_model=MessagesOut)
async def get_thread(message_id: str, user: SessionUser = Depends(current_user)) -> MessagesOut:
    async with session_scope() as session:
        root = await message_service.by_id(session, message_id)
        if root is None:
            raise not_found("That thread no longer exists.")
        await channel_service.assert_channel_access(session, user.id, root.channel_id)
        messages = await message_service.thread(session, message_id)
    return MessagesOut(messages=messages)


@router.get("/api/threads", response_model=MessagesOut)
async def list_threads(user: SessionUser = Depends(current_user)) -> MessagesOut:
    """Threads the user started or replied to — the sidebar's Threads view."""
    async with session_scope() as session:
        messages = await message_service.threads_for_user(session, user.id)
    return MessagesOut(messages=messages)


@router.patch("/api/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: str, payload: EditMessageInput, user: SessionUser = Depends(current_user)
) -> MessageOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, message_id)
        if existing is None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_member=True
        )
        message = await message_service.edit(
            session, message_id, user.id, user.workspace_id, payload.body
        )
        after.add(
            lambda: hub.to_channel(message.channel_id, _message_event("message.updated", message))
        )
    return MessageOut(message=message)


@router.delete("/api/messages/{message_id}", response_model=OkOut)
async def delete_message(message_id: str, user: SessionUser = Depends(current_user)) -> OkOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, message_id)
        if existing is None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_member=True
        )
        channel_id, thread_root_id = await message_service.remove(
            session, message_id, user.id, user.is_admin
        )
        after.add(
            lambda: hub.to_channel(
                channel_id,
                {
                    "t": "message.deleted",
                    "id": message_id,
                    "channelId": channel_id,
                    "threadRootId": thread_root_id,
                },
            )
        )
    return OkOut()


@router.put("/api/messages/{message_id}/pin", response_model=MessageOut)
async def pin_message(
    message_id: str, payload: PinInput, user: SessionUser = Depends(current_user)
) -> MessageOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, message_id)
        if existing is None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_member=True, require_writable=True
        )
        message = await message_service.set_pinned(session, message_id, user.id, payload.pinned)
        after.add(
            lambda: hub.to_channel(message.channel_id, _message_event("message.updated", message))
        )
    return MessageOut(message=message)


# ─── reactions ────────────────────────────────────────────────────────────────
@router.put("/api/messages/{message_id}/reactions", response_model=OkOut)
async def add_reaction(
    message_id: str, payload: ReactionInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, message_id)
        if existing is None or existing.deleted_at is not None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_member=True, require_writable=True
        )
        if await message_service.add_reaction(session, message_id, user.id, payload.emoji):
            after.add(
                lambda: hub.to_channel(
                    existing.channel_id,
                    {
                        "t": "reaction.added",
                        "messageId": message_id,
                        "channelId": existing.channel_id,
                        "emoji": payload.emoji,
                        "userId": user.id,
                    },
                )
            )
    return OkOut()


@router.delete("/api/messages/{message_id}/reactions", response_model=OkOut)
async def remove_reaction(
    message_id: str,
    emoji: Annotated[str, Query(min_length=1, max_length=64)],
    user: SessionUser = Depends(current_user),
) -> OkOut:
    async with transaction() as (session, after):
        existing = await message_service.by_id(session, message_id)
        if existing is None:
            raise not_found("That message is gone.")
        if await message_service.remove_reaction(session, message_id, user.id, emoji):
            after.add(
                lambda: hub.to_channel(
                    existing.channel_id,
                    {
                        "t": "reaction.removed",
                        "messageId": message_id,
                        "channelId": existing.channel_id,
                        "emoji": emoji,
                        "userId": user.id,
                    },
                )
            )
    return OkOut()


# ─── read state ───────────────────────────────────────────────────────────────
@router.post("/api/channels/{channel_id}/read", response_model=ReadStateResponse)
async def mark_read(
    channel_id: str, payload: MarkReadInput, user: SessionUser = Depends(current_user)
) -> ReadStateResponse:
    async with transaction() as (session, after):
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        state = await read_state_service.mark_read(
            session, user.id, channel_id, payload.last_read_message_id
        )
        after.add(lambda: read_state_service.broadcast(user.id, state))
    return ReadStateResponse(read_state=state)


@router.get("/api/read-states", response_model=ReadStatesOut)
async def list_read_states(user: SessionUser = Depends(current_user)) -> ReadStatesOut:
    async with session_scope() as session:
        states = await read_state_service.list_for_user(session, user.id)
        total = await read_state_service.total_mentions(session, user.id)
    return ReadStatesOut(read_states=states, total_mentions=total)


# ─── incoming webhooks ────────────────────────────────────────────────────────
@router.post("/api/hooks/{token}", response_model=OkOut, status_code=202)
async def incoming_webhook(token: str, payload: WebhookPostInput) -> OkOut:
    """Post to a channel with a token instead of a session."""
    await consume("webhook", token[:16])

    async with transaction() as (session, after):
        hook = (
            await session.execute(
                text(
                    """
                    SELECT id, workspace_id, channel_id, created_by, name
                      FROM webhooks WHERE token_hash = :token_hash
                    """
                ),
                {"token_hash": hash_token(token)},
            )
        ).fetchone()
        if hook is None:
            raise forbidden("That webhook is not valid.")

        body = f"**{payload.username}**\n{payload.text}" if payload.username else payload.text
        result = await message_service.send(
            session,
            workspace_id=hook.workspace_id,
            channel_id=hook.channel_id,
            author_id=hook.created_by,
            kind="bot",
            body=body,
            # Each webhook post is its own message; the idempotency key is per-call.
            client_msg_id=f"hook-{new_id()}",
        )
        await session.execute(
            text("UPDATE webhooks SET last_used_at = now() WHERE id = :id"), {"id": hook.id}
        )

        if result.created:
            channel_id = hook.channel_id

            def broadcast_hook() -> None:
                hub.to_channel(channel_id, _message_event("message.new", result.message))
                _schedule(enqueue("notify", result.message.id))

            after.add(broadcast_hook)

    return OkOut()


__all__ = ["router"]
