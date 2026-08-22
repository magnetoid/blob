"""Running an AG-UI agent when somebody mentions it.

A person @-mentions an app's bot in a channel that bot has joined. This POSTs the
surrounding conversation to the app's AG-UI endpoint as a standard `RunAgentInput`,
reads the event stream back, and writes whatever the agent said as ordinary messages
from that bot, in the place it was addressed.

It never raises. An arq retry would re-run the agent — new tokens, new latency, possibly
a different answer — so every failure is caught, recorded on the plugin, and told to the
person who asked. The same reasoning as `plugins/delivery.py`: an app that misbehaves
degrades itself and nothing else.

No transaction is ever open across the HTTP call. The session that reads the history is
closed before the agent is contacted, and each message the agent produces commits on its
own, so a failure on the third answer cannot roll back the first two.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.errors import AppError
from ..lib.queue import enqueue, fire_and_forget
from ..lib.redis import redis
from ..plugins import agui
from ..plugins import events as plugin_events
from ..plugins.signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign
from ..realtime import hub
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services.serialize import message_event

log = logging.getLogger("blob.jobs.agui")


@dataclass(slots=True)
class Listener:
    plugin_id: str
    slug: str
    name: str
    bot_user_id: str
    agui_url: str
    signing_secret: str


async def listeners_for(
    session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str]
) -> list[Listener]:
    """Mentioned bots whose app speaks AG-UI, is enabled, and may post.

    The enabled-and-scoped filter is the same one the bot API and the delivery drain
    apply. An app that was disabled or had `messages:write` revoked must not keep
    answering because a mention reached a queue first.
    """
    if not mention_user_ids:
        return []
    rows = (
        await session.execute(
            text(
                """
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url, s.signing_secret
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   AND p.agui_url IS NOT NULL
                   AND u.id = ANY(cast(:ids AS uuid[]))
                   AND u.deactivated_at IS NULL
                   AND EXISTS (
                     SELECT 1 FROM plugin_grants g
                      WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
                """
            ),
            {"ws": workspace_id, "ids": mention_user_ids},
        )
    ).fetchall()
    return [
        Listener(
            plugin_id=row.id,
            slug=row.slug,
            name=row.name,
            bot_user_id=row.bot_user_id,
            agui_url=row.agui_url,
            signing_secret=row.signing_secret,
        )
        for row in rows
    ]


async def stream_run(
    listener: Listener,
    run_input: dict[str, Any],
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[agui.Fold, list[agui.Post], str | None]:
    """Call the agent and fold its stream. Returns (fold, messages to post, error).

    The posts are collected as they are sealed rather than gathered at the end: a
    message is emitted by `feed` the moment its TEXT_MESSAGE_END arrives, so a caller
    that only read `finish()` would post the last message and silently drop the rest.

    The body is signed exactly as a webhook delivery is — same header names, same `v0=`
    scheme — so an app that already verifies Blob's deliveries verifies this with the
    code it has.
    """
    fold = agui.Fold()
    posts: list[agui.Post] = []
    decoder = agui.SseDecoder()
    body = json.dumps(run_input).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "accept": "text/event-stream",
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: sign(listener.signing_secret, timestamp, body),
    }

    seen_events = 0
    seen_bytes = 0
    timeout = httpx.Timeout(
        settings.AGUI_TIMEOUT_SEC, read=settings.AGUI_READ_TIMEOUT_SEC
    )

    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            async with client.stream(
                "POST", listener.agui_url, content=body, headers=headers
            ) as response:
                if response.status_code >= 400:
                    return fold, posts, f"the agent answered {response.status_code}"
                async for chunk in response.aiter_bytes():
                    seen_bytes += len(chunk)
                    if seen_bytes > settings.AGUI_MAX_BYTES:
                        posts.extend(fold.finish())
                        return fold, posts, "the agent sent more than we will read"
                    for event in decoder.feed(chunk):
                        seen_events += 1
                        if seen_events > settings.AGUI_MAX_EVENTS:
                            posts.extend(fold.finish())
                            return fold, posts, "the agent sent more events than we will read"
                        posts.extend(fold.feed(event))
                        if fold.finished:
                            return fold, posts, None
                for event in decoder.close():
                    posts.extend(fold.feed(event))
    except httpx.TimeoutException:
        posts.extend(fold.finish())
        return fold, posts, "the agent did not finish in time"
    except httpx.HTTPError as error:
        posts.extend(fold.finish())
        return fold, posts, f"the agent could not be reached: {error}"

    # A stream that ended without RUN_FINISHED is treated as done, not as an error: an
    # answer that arrived in full should not get an apology appended under it.
    posts.extend(fold.finish())
    return fold, posts, None


async def _post_as_bot(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    body: str,
    client_msg_id: str,
    blocks: list[dict[str, Any]] | None,
) -> None:
    """One message, the way the bot API posts one.

    Duplicated rather than shared for now because `jobs/` and `plugins/` may not import
    `routers/`; the tidy-up is for `bot_api` to adopt this, in a commit that is allowed
    to touch the `/api/v1/` contract.
    """
    async with transaction() as (session, after):
        result = await message_service.send(
            session,
            workspace_id=workspace_id,
            channel_id=channel_id,
            author_id=listener.bot_user_id,
            body=body,
            client_msg_id=client_msg_id,
            thread_root_id=thread_root_id,
            kind="bot",
            plugin_id=listener.plugin_id,
            blocks=blocks,
        )
        if not result.created:
            return  # Already posted by an earlier run of this job.

        message = result.message
        thread_update = result.thread_update
        await audit_service.record(
            session,
            audit_service.Actor(id=listener.bot_user_id, workspace_id=workspace_id),
            "bot.message_posted",
            target_type="message",
            target_id=message.id,
            metadata={"channelId": channel_id, "via": "agui"},
        )
        await plugin_events.emit(
            session,
            workspace_id=workspace_id,
            event="message.created",
            channel_id=channel_id,
            payload=message.model_dump(by_alias=True),
            exclude_plugin_id=listener.plugin_id,
        )

        def broadcast() -> None:
            hub.to_channel(channel_id, message_event("message.new", message))
            if thread_update:
                hub.to_channel(channel_id, thread_update.as_event())
            fire_and_forget(enqueue("notify", message.id))
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)


async def _record_error(plugin_id: str, reason: str) -> None:
    async with transaction() as (session, _):
        await session.execute(
            text("UPDATE plugins SET last_error = :reason, updated_at = now() WHERE id = :id"),
            {"reason": reason[:500], "id": plugin_id},
        )


async def _claim(message_id: str) -> bool:
    """Best-effort lease so a duplicate enqueue does not pay for the same run twice.

    The unique index on `client_msg_id` is what actually prevents duplicate rows. This
    only saves tokens, so failing open is correct: if Redis is unavailable the run
    still happens and still cannot double-post.
    """
    try:
        claimed = await redis.set(f"agui:run:{message_id}", "1", nx=True, ex=300)
        return bool(claimed)
    except Exception:
        log.warning("could not take the agui run lease", exc_info=True)
        return True


async def handle_agui_run(message_id: str) -> None:
    try:
        await _run(message_id)
    except Exception:
        # Nothing above this catches, and an arq retry would re-run the agent.
        log.warning("agui run failed for %s", message_id, exc_info=True)


async def _run(message_id: str) -> None:
    if not await _claim(message_id):
        return

    async with session_scope() as session:
        trigger = (
            await session.execute(
                text(
                    """
                    SELECT id, workspace_id, channel_id, author_id, kind,
                           thread_root_id, mention_user_ids, deleted_at
                      FROM messages WHERE id = :id
                    """
                ),
                {"id": message_id},
            )
        ).first()

        # Only a person starts a run. This is the loop guard, and it is structural: two
        # agents that mention each other cannot converse forever because neither one's
        # messages are a trigger.
        if not trigger or trigger.deleted_at or trigger.kind != "user":
            return
        mentioned = list(trigger.mention_user_ids or [])
        if not mentioned:
            return

        listeners = await listeners_for(
            session, workspace_id=trigger.workspace_id, mention_user_ids=mentioned
        )
        if not listeners:
            return

        asker = (
            await session.execute(
                text("SELECT display_name FROM users WHERE id = :id"),
                {"id": trigger.author_id},
            )
        ).scalar_one_or_none()
        channel_name = (
            await session.execute(
                text("SELECT name FROM channels WHERE id = :id"), {"id": trigger.channel_id}
            )
        ).scalar_one_or_none()

    for listener in listeners:
        await _run_one(
            listener,
            workspace_id=trigger.workspace_id,
            channel_id=trigger.channel_id,
            thread_root_id=trigger.thread_root_id,
            trigger_id=trigger.id,
            asker=asker or "someone",
            channel_name=channel_name or "a conversation",
        )


async def _run_one(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    asker: str,
    channel_name: str,
) -> None:
    async with session_scope() as session:
        try:
            await channel_service.assert_channel_access(
                session,
                listener.bot_user_id,
                channel_id,
                require_member=True,
                require_writable=True,
            )
        except AppError:
            # The bot cannot see or write here. It says nothing at all: a private channel
            # answers 404 precisely so that its existence is not disclosed, and an app
            # announcing "I can't read this" would disclose it.
            return

        if thread_root_id:
            history = await message_service.thread(session, thread_root_id)
        else:
            # `history` already returns oldest-first; it sorts the keyset page back
            # into ascending order before returning it.
            history, _ = await message_service.history(
                session, channel_id, limit=settings.AGUI_HISTORY_LIMIT
            )

        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, display_name FROM users
                     WHERE id = ANY(cast(:ids AS uuid[]))
                    """
                ),
                {"ids": [m.author_id for m in history if m.author_id]},
            )
        ).fetchall()
        names: dict[str, str] = {row.id: row.display_name for row in rows}

    run_input = agui.build_run_input(
        thread_id=thread_root_id or channel_id,
        run_id=trigger_id,
        messages=agui.to_agui_messages(
            history, bot_user_id=listener.bot_user_id, names=names
        ),
        channel_name=channel_name,
        trigger_user=asker,
    )

    fold, posts, transport_error = await stream_run(listener, run_input)

    for post in posts:
        await _post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=post.body,
            client_msg_id=post.client_msg_id(trigger_id),
            blocks=post.blocks(),
        )

    reason = transport_error or fold.error
    if reason:
        await _record_error(listener.plugin_id, reason)
        await _post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=f"I couldn't finish that — {reason}.",
            client_msg_id=f"agui:{trigger_id}:error",
            blocks=None,
        )
    elif fold.interrupt:
        await _post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=f"Needs a decision: {fold.interrupt}",
            client_msg_id=f"agui:{trigger_id}:interrupt",
            blocks=None,
        )
    # A run that finished cleanly and said nothing posts nothing. Silence is a legitimate
    # answer, and "the agent had no reply" is worse noise than no reply.


__all__ = ["Listener", "handle_agui_run", "listeners_for", "stream_run"]
