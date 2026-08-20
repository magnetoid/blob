"""Message endpoints.

Note the shape of every write: do the database work, let it commit, *then* broadcast and
enqueue. Nothing in this file emits inside a transaction.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, hash_token
from ..lib.errors import forbidden, not_found
from ..lib.ids import new_id
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..plugins import events as plugin_events
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import Message, MessageTranslation, ReadStateOut
from ..schemas.requests import (
    EditMessageInput,
    MarkReadInput,
    PinInput,
    ReactionInput,
    SendMessageInput,
    TranslateMessageInput,
    WebhookPostInput,
)
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import read_state as read_state_service
from ..services import translation as translation_service
from ..services.serialize import message_event

router = APIRouter(tags=["messages"])

URL_RE = re.compile(r"https?://")


class HistoryOut(CamelModel):
    messages: list[Message]
    has_more: bool


class MessagesOut(CamelModel):
    messages: list[Message]


class MessageOut(CamelModel):
    message: Message


class MessageTranslationOut(CamelModel):
    translation: MessageTranslation


class ReadStateResponse(CamelModel):
    read_state: ReadStateOut


class ReadStatesOut(CamelModel):
    read_states: list[ReadStateOut]
    total_mentions: int


class OkOut(CamelModel):
    ok: bool = True


def _plugin_drain() -> None:
    """Nudge the worker to deliver what the transaction just queued.

    The outbox is also drained on a timer, so this is a latency improvement rather than
    the delivery mechanism — if the enqueue is lost, the events still go out.
    """
    fire_and_forget(enqueue("deliver_plugin_events"))


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
            # Inside the transaction, deliberately. The outbox row and the message it
            # describes commit together or not at all, so an app is never told about a
            # message that was rolled back, and never misses one because the process
            # died between COMMIT and the HTTP call.
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="message.created",
                payload=result.message.model_dump(by_alias=True),
            )

            def broadcast() -> None:
                hub.to_channel(channel_id, message_event("message.new", result.message))
                if result.thread_update:
                    hub.to_channel(channel_id, result.thread_update.as_event())
                fire_and_forget(enqueue("notify", result.message.id))
                if URL_RE.search(payload.body):
                    fire_and_forget(enqueue("unfurl", result.message.id))
                _plugin_drain()

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


@router.post("/api/messages/{message_id}/translate", response_model=MessageTranslationOut)
async def translate_message(
    message_id: str,
    payload: TranslateMessageInput,
    user: SessionUser = Depends(current_user),
) -> MessageTranslationOut:
    async with transaction() as (session, _after):
        message = await message_service.by_id(session, message_id)
        if message is None or message.deleted_at is not None:
            raise not_found("That message is gone.")
        await channel_service.assert_channel_access(session, user.id, message.channel_id)
        prefs_row = (
            await session.execute(text("SELECT prefs FROM users WHERE id = :id"), {"id": user.id})
        ).fetchone()
        target_language = payload.target_language or (
            prefs_row.prefs.get("language")
            if prefs_row is not None and isinstance(prefs_row.prefs, dict)
            else None
        )
        if not isinstance(target_language, str) or not target_language.strip():
            raise forbidden("Set your preferred language before using translation.")
        normalized_target = translation_service.normalize_language_code(target_language)
        if not payload.force_refresh:
            cached = await translation_service.get_cached_translation(
                session,
                message_id=message.id,
                target_language=normalized_target,
                source_body=message.body,
            )
            if cached is not None:
                return MessageTranslationOut(translation=cached)

        translated = await translation_service.translate_text(
            message.body,
            target_language=normalized_target,
        )
        stored = await translation_service.store_translation(
            session,
            workspace_id=user.workspace_id,
            message_id=message.id,
            requested_by=user.id,
            source_body=message.body,
            payload=translated,
        )
    return MessageTranslationOut(translation=stored)


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
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="message.updated",
            payload=message.model_dump(by_alias=True),
        )

        def broadcast_edit() -> None:
            hub.to_channel(message.channel_id, message_event("message.updated", message))
            _plugin_drain()

        after.add(broadcast_edit)
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
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="message.deleted",
            payload={"id": message_id, "channelId": channel_id},
        )

        def broadcast_delete() -> None:
            hub.to_channel(
                channel_id,
                {
                    "t": "message.deleted",
                    "id": message_id,
                    "channelId": channel_id,
                    "threadRootId": thread_root_id,
                },
            )
            _plugin_drain()

        after.add(broadcast_delete)
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
            lambda: hub.to_channel(message.channel_id, message_event("message.updated", message))
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
            reaction = {
                "messageId": message_id,
                "channelId": existing.channel_id,
                "emoji": payload.emoji,
                "userId": user.id,
            }
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="reaction.added",
                payload=reaction,
            )

            def broadcast_reaction() -> None:
                hub.to_channel(existing.channel_id, {"t": "reaction.added", **reaction})
                _plugin_drain()

            after.add(broadcast_reaction)
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
            reaction = {
                "messageId": message_id,
                "channelId": existing.channel_id,
                "emoji": emoji,
                "userId": user.id,
            }
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="reaction.removed",
                payload=reaction,
            )
            after.add(
                lambda: hub.to_channel(
                    existing.channel_id,
                    {"t": "reaction.removed", **reaction},
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
            await plugin_events.emit(
                session,
                workspace_id=hook.workspace_id,
                event="message.created",
                payload=result.message.model_dump(by_alias=True),
            )

            def broadcast_hook() -> None:
                hub.to_channel(channel_id, message_event("message.new", result.message))
                fire_and_forget(enqueue("notify", result.message.id))
                _plugin_drain()

            after.add(broadcast_hook)

    return OkOut()


__all__ = ["router"]
