"""Message endpoints.

Note the shape of every write: do the database work, let it commit, *then* broadcast and
enqueue. Nothing in this file emits inside a transaction.
"""

from __future__ import annotations

import re
from functools import partial
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, hash_token
from ..lib.errors import forbidden, not_found
from ..lib.ids import IdParam, new_id
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..lib.times import parse_client_time, parse_future_time
from ..plugins import events as plugin_events
from ..realtime import hub
from ..schemas.base import CamelModel
from ..schemas.models import Message, MessageTranslation, ReadStateOut, ScheduledMessage
from ..schemas.requests import (
    EditMessageInput,
    MarkReadInput,
    MarkUnreadInput,
    PinInput,
    ReactionInput,
    SaveInput,
    SendMessageInput,
    TranslateMessageInput,
    WebhookPostInput,
)
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import read_state as read_state_service
from ..services import scheduled as scheduled_service
from ..services import translation as translation_service
from ..services.audit import actor_for
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


async def load_message_for(
    session: AsyncSession,
    user: SessionUser,
    message_id: str,
    *,
    allow_deleted: bool = False,
    require_member: bool = False,
    require_writable: bool = False,
) -> Message:
    """The prologue every per-message route performed by hand, seven slightly
    different times: fetch, refuse the missing and (usually) the deleted, and make the
    channel answer for who may act. One place now, so "does this route check
    deleted_at" stops being a per-route accident — three of the seven did, and which
    three was not a decision anybody had made.

    `allow_deleted` exists for deletion itself: deleting twice stays idempotent
    rather than answering the second click with a 404.
    """
    message = await message_service.by_id(session, message_id)
    if message is None or (message.deleted_at is not None and not allow_deleted):
        raise not_found("That message is gone.")
    await channel_service.assert_channel_access(
        session,
        user.id,
        message.channel_id,
        require_member=require_member,
        require_writable=require_writable,
    )
    return message


@router.get("/api/channels/{channel_id}/messages", response_model=HistoryOut)
async def get_history(
    channel_id: IdParam,
    # The cursors are ids too, and were the other half of the same 500: a malformed
    # `before` reached the SQL and Postgres refused it, which surfaced as an internal
    # error for a value the client supplied.
    before: IdParam | None = None,
    after: IdParam | None = None,
    around: IdParam | None = None,
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
    channel_id: IdParam,
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

        # One shared fan-out, in `services/messages.announce`, because this used to live
        # here and the scheduled sweep had no copy of it at all.
        await message_service.announce(
            session,
            after_commit,
            result,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
        )

    response.status_code = 201 if result.created else 200
    return MessageOut(message=result.message)


@router.get("/api/messages/{message_id}", response_model=MessageOut)
async def get_message(message_id: IdParam, user: SessionUser = Depends(current_user)) -> MessageOut:
    """One message by id — what a permalink resolves against.

    The missing verb in this file: a message could be edited, deleted, pinned, reacted
    to and read as a thread, but not simply fetched. A link has to be resolvable before
    the client knows which channel to open, and a thread reply is never in channel
    history — `history` filters `thread_root_id IS NULL` in all three of its modes — so
    the reply's own row is the only thing that can say which thread to open.

    404 for deleted and for no access alike, which is the rule everywhere here: whether
    a message exists is not something a link should be able to probe.
    """
    async with session_scope() as session:
        message = await load_message_for(session, user, message_id)
    return MessageOut(message=message)


@router.get("/api/messages/{message_id}/thread", response_model=MessagesOut)
async def get_thread(message_id: IdParam, user: SessionUser = Depends(current_user)) -> MessagesOut:
    async with session_scope() as session:
        # A deleted root still anchors its replies, so the thread stays readable.
        await load_message_for(session, user, message_id, allow_deleted=True)
        messages = await message_service.thread(session, message_id)
    return MessagesOut(messages=messages)


@router.post("/api/messages/{message_id}/translate", response_model=MessageTranslationOut)
async def translate_message(
    message_id: IdParam,
    payload: TranslateMessageInput,
    user: SessionUser = Depends(current_user),
) -> MessageTranslationOut:
    # Every call can reach a metered third party, so it is limited like sending is.
    # Without this, one member in a loop could spend the workspace's translation budget.
    await consume("translate", user.id)

    # Read and cache-check in one short transaction, translate outside it, store in
    # another. The provider is allowed ten seconds; holding a Postgres transaction open
    # for a remote call that long blocks vacuum and ties up a pooled connection for
    # something that is not database work.
    async with session_scope() as session:
        message = await load_message_for(session, user, message_id)
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

    async with transaction() as (session, _after):
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
    message_id: IdParam, payload: EditMessageInput, user: SessionUser = Depends(current_user)
) -> MessageOut:
    async with transaction() as (session, after):
        await load_message_for(session, user, message_id, require_member=True)
        message = await message_service.edit(
            session, message_id, user.id, user.workspace_id, payload.body
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="message.updated",
            channel_id=message.channel_id,
            payload=message.model_dump(by_alias=True),
        )

        def broadcast_edit() -> None:
            hub.to_channel(message.channel_id, message_event("message.updated", message))
            _plugin_drain()

        after.add(broadcast_edit)
    return MessageOut(message=message)


@router.delete("/api/messages/{message_id}", response_model=OkOut)
async def delete_message(
    message_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, after):
        existing = await load_message_for(
            session, user, message_id, allow_deleted=True, require_member=True
        )
        moderated = existing.author_id != user.id
        channel_id, thread_root_id = await message_service.remove(
            session, message_id, user.id, user.is_admin
        )
        if moderated:
            # Deleting someone else's message only succeeds for an admin, and that is
            # exactly the act the log exists for. Self-deletes are not recorded: auditing
            # every one of those is surveillance of ordinary use, not forensics.
            await audit_service.record(
                session,
                actor_for(request, user),
                "message.deleted",
                target_type="message",
                target_id=message_id,
                metadata={"channelId": channel_id, "authorId": existing.author_id},
            )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="message.deleted",
            channel_id=channel_id,
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
    message_id: IdParam, payload: PinInput, user: SessionUser = Depends(current_user)
) -> MessageOut:
    async with transaction() as (session, after):
        await load_message_for(
            session, user, message_id, require_member=True, require_writable=True
        )
        message = await message_service.set_pinned(session, message_id, user.id, payload.pinned)
        after.add(
            lambda: hub.to_channel(message.channel_id, message_event("message.updated", message))
        )
    return MessageOut(message=message)


@router.put("/api/messages/{message_id}/save", response_model=OkOut)
async def save_message(
    message_id: IdParam, payload: SaveInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Put a message aside for yourself. Slack's Later.

    Membership, but not writability: pinning needs a channel you can still post in
    because it changes the channel, and this changes nothing anybody else can see. A
    message in an archived channel is exactly the kind you want to keep hold of.

    Nothing is broadcast. There is no second reader — the list is one person's, and an
    event would be a delivery path with a single subscriber who already holds the
    response. `/api/commands` settled the same question the same way.
    """
    async with transaction() as (session, _):
        await load_message_for(session, user, message_id, require_member=True)
        await message_service.set_saved(session, message_id, user.id, payload.saved)
    return OkOut()


@router.get("/api/saved", response_model=MessagesOut)
async def list_saved(user: SessionUser = Depends(current_user)) -> MessagesOut:
    """Everything put aside, newest first — the flat form the older client read."""
    async with session_scope() as session:
        messages = await message_service.list_saved(session, user.id)
    return MessagesOut(messages=messages)


class LaterItemOut(CamelModel):
    message: Message
    state: Literal["in_progress", "archived", "done"]
    remind_at: str | None
    reminded_at: str | None
    note: str | None


class LaterOut(CamelModel):
    items: list[LaterItemOut]


class LaterInput(CamelModel):
    state: Literal["in_progress", "archived", "done"] | None = None
    #: ISO timestamp, or explicit null to clear the reminder. Absent leaves it alone.
    remind_at: str | None = None
    note: str | None = Field(default=None, max_length=500)


@router.get("/api/later", response_model=LaterOut)
async def list_later(
    state: Literal["in_progress", "archived", "done"] = "in_progress",
    user: SessionUser = Depends(current_user),
) -> LaterOut:
    """The Later view proper: saved messages with their state and reminder."""
    async with session_scope() as session:
        items = await message_service.list_later(session, user.id, state=state)
    return LaterOut(items=[LaterItemOut(**item) for item in items])


@router.patch("/api/saved/{message_id}", response_model=OkOut)
async def update_later(
    message_id: IdParam, payload: LaterInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Move a saved item between states, or set a reminder on it.

    Upserts the save itself, so "remind me about this" from a message's menu is one
    gesture. Setting a reminder re-arms one that already fired.
    """
    given = payload.model_fields_set
    remind_at: Any = message_service._UNSET
    if "remind_at" in given:
        if payload.remind_at is None:
            remind_at = None
        else:
            # A naive time used to parse fine here and then raise `TypeError` on the
            # comparison below — past the `except ValueError`, so it answered 500.
            remind_at = parse_future_time(payload.remind_at)

    async with transaction() as (session, _):
        await load_message_for(session, user, message_id, require_member=True)
        await message_service.set_later(
            session,
            message_id,
            user.id,
            state=payload.state,
            remind_at=remind_at,
            note=payload.note if "note" in given else message_service._UNSET,
        )
    return OkOut()


# ─── reactions ────────────────────────────────────────────────────────────────
@router.put("/api/messages/{message_id}/reactions", response_model=OkOut)
async def add_reaction(
    message_id: IdParam, payload: ReactionInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, after):
        existing = await load_message_for(
            session, user, message_id, require_member=True, require_writable=True
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
                channel_id=existing.channel_id,
                payload=reaction,
            )

            def broadcast_reaction() -> None:
                hub.to_channel(existing.channel_id, {"t": "reaction.added", **reaction})
                _plugin_drain()

            after.add(broadcast_reaction)
    return OkOut()


@router.delete("/api/messages/{message_id}/reactions", response_model=OkOut)
async def remove_reaction(
    message_id: IdParam,
    emoji: Annotated[str, Query(min_length=1, max_length=64)],
    user: SessionUser = Depends(current_user),
) -> OkOut:
    async with transaction() as (session, after):
        # Removing a reaction can only ever touch your own, so nothing here is
        # destroyable — the access check exists because answering 200 for a message in
        # a channel you cannot see and 404 for one that does not exist would say which
        # private message ids are real, the distinction the 404 hides. Deleted counts
        # as gone: after deletion the reaction rows are gone with it.
        existing = await load_message_for(session, user, message_id)
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
                channel_id=existing.channel_id,
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
    channel_id: IdParam, payload: MarkReadInput, user: SessionUser = Depends(current_user)
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


@router.post("/api/channels/{channel_id}/unread", response_model=ReadStateResponse)
async def mark_unread(
    channel_id: IdParam, payload: MarkUnreadInput, user: SessionUser = Depends(current_user)
) -> ReadStateResponse:
    """Leave a message, and everything after it, unread.

    Its own route rather than a flag on `/read`, because that one is a ratchet and the
    ratchet protects something: two tabs both mark read on focus, and a stale one
    arriving second must not un-read what the other just read. Rewinding is a thing a
    person asks for, so it says so.
    """
    async with transaction() as (session, after):
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        message = await message_service.by_id(session, payload.message_id)
        if message is None or message.channel_id != channel_id:
            raise not_found("That message is gone.")
        state = await read_state_service.mark_unread(
            session, user.id, channel_id, payload.message_id
        )
        after.add(lambda: read_state_service.broadcast(user.id, state))
    return ReadStateResponse(read_state=state)


@router.post("/api/read-states/all", response_model=ReadStatesOut)
async def mark_all_read(user: SessionUser = Depends(current_user)) -> ReadStatesOut:
    """Slack's Shift+Esc: everything, everywhere, read.

    Broadcasts one event per channel that actually moved rather than a single
    "all read" event, so the other tabs apply it through the same reducer every
    other read-state change goes through — a second kind of event would be a
    second path to keep in step with the first.
    """
    async with transaction() as (session, after):
        states = await read_state_service.mark_all_read(session, user.id)
        for state in states:
            # partial rather than a closure: these run past COMMIT, by which point a
            # lambda over the loop variable would broadcast the last state N times.
            after.add(partial(read_state_service.broadcast, user.id, state))
    return ReadStatesOut(read_states=states, total_mentions=0)


# ─── scheduled messages ───────────────────────────────────────────────────────
class ScheduleInput(CamelModel):
    body: str = Field(min_length=1, max_length=12_000)
    send_at: str
    client_msg_id: str = Field(min_length=1, max_length=200)
    thread_root_id: IdParam | None = None
    #: How it repeats, if it does. Checked in the service, so the refusal reads as a
    #: sentence rather than as a schema violation.
    repeat: str | None = Field(default=None, max_length=20)
    #: The author's zone, because "every weekday at nine" is a wall-clock statement.
    #: An unknown one falls back to UTC rather than refusing — see `services/recurrence`.
    timezone: str = Field(default="UTC", max_length=64)


class ScheduledOut(CamelModel):
    scheduled: ScheduledMessage


class ScheduledListOut(CamelModel):
    scheduled: list[ScheduledMessage]


@router.post("/api/channels/{channel_id}/schedule", response_model=ScheduledOut)
async def schedule_message(
    channel_id: IdParam, payload: ScheduleInput, user: SessionUser = Depends(current_user)
) -> ScheduledOut:
    """Write it now, send it then."""
    # This route had the guard the other three lacked; it now shares it.
    send_at = parse_client_time(payload.send_at)

    async with transaction() as (session, _):
        scheduled = await scheduled_service.schedule(
            session,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            author_id=user.id,
            body=payload.body,
            send_at=send_at,
            client_msg_id=payload.client_msg_id,
            thread_root_id=payload.thread_root_id,
            repeat=payload.repeat,
            timezone=payload.timezone,
        )
    return ScheduledOut(scheduled=scheduled)


@router.get("/api/scheduled", response_model=ScheduledListOut)
async def list_scheduled(user: SessionUser = Depends(current_user)) -> ScheduledListOut:
    """Only ever your own: a scheduled message is private until it is sent."""
    async with session_scope() as session:
        scheduled = await scheduled_service.list_for_author(session, user.id)
    return ScheduledListOut(scheduled=scheduled)


@router.delete("/api/scheduled/{scheduled_id}", response_model=OkOut)
async def cancel_scheduled(
    scheduled_id: IdParam, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        await scheduled_service.cancel(session, user.id, scheduled_id)
    return OkOut()


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
            # A caller that supplies its own id can retry a timed-out POST safely;
            # one that doesn't gets a fresh id, and each such call is its own message.
            client_msg_id=f"hook-{payload.client_msg_id or new_id()}",
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
                channel_id=channel_id,
                payload=result.message.model_dump(by_alias=True),
            )

            def broadcast_hook() -> None:
                hub.to_channel(channel_id, message_event("message.new", result.message))
                fire_and_forget(enqueue("notify", result.message.id))
                _plugin_drain()

            after.add(broadcast_hook)

    return OkOut()


__all__ = ["router"]
