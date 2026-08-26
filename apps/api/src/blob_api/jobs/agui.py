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

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.errors import AppError
from ..lib.queue import enqueue, fire_and_forget
from ..lib.redis import redis
from ..plugins import agui, builtin
from ..plugins import events as plugin_events
from ..plugins.streams import Listener, stream_run
from ..realtime import hub, presence
from ..realtime.protocol import TYPING_TTL_MS
from ..services import agent_runs as agent_run_service
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services.serialize import message_event

log = logging.getLogger("blob.jobs.agui")


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
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
                       p.runtime, s.signing_secret, w.name AS workspace_name
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                  JOIN workspaces w ON w.id = p.workspace_id
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   -- An address, a connection it opened itself, or no network at all.
                   -- A socket agent has no agui_url and the built-in agent has neither
                   -- end, so the URL test alone would filter out every one of both.
                   AND (p.agui_url IS NOT NULL OR p.runtime IN ('socket', 'builtin'))
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
            runtime=row.runtime,
            workspace_name=row.workspace_name,
        )
        for row in rows
    ]


async def personal_agent_for(
    session: AsyncSession, *, workspace_id: str, channel_id: str
) -> Listener | None:
    """The built-in agent, if this channel is one person's private room with it.

    A DM with the agent needs no `@Blob`, because there is nobody else it could be
    addressed to — which is the whole reason a personal agent works without a second
    identity, a second bot, or a row anywhere. The room is what makes it personal.

    **Every condition is in the statement, and none of them is `kind` alone.** `kind` is
    set from the member count when a DM is created and never re-derived, while
    `app_join_channel` can add a bot to a channel with no kind test at all — so a
    `kind='dm'` row can hold three members, and a design that trusted the label would put
    a model told "this is your private room with Ada" into a room Bo is also reading. The
    count is therefore checked directly, in the same query as everything else.

    Scoped to `runtime = 'builtin'` deliberately. Widening the trigger to "any bot in a
    DM" would hand every installed third-party app a run for every line typed at it, with
    no manifest opt-in and no way for its author to decline — a change to somebody else's
    contract, smuggled in as a convenience.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
                       p.runtime, s.signing_secret, w.name AS workspace_name,
                       other.display_name AS owner_name
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                  JOIN workspaces w ON w.id = p.workspace_id
                  JOIN channels c ON c.id = :channel_id
                                 AND c.workspace_id = p.workspace_id
                                 AND c.kind = 'dm'
                  -- The bot is in the room ...
                  JOIN channel_members bot_m ON bot_m.channel_id = c.id
                                            AND bot_m.user_id = u.id
                  -- ... and exactly one other person is, who is a person.
                  JOIN channel_members other_m ON other_m.channel_id = c.id
                                              AND other_m.user_id <> u.id
                  JOIN users other ON other.id = other_m.user_id
                                  AND other.kind = 'human'
                                  AND other.deactivated_at IS NULL
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   AND p.runtime = :runtime
                   AND u.deactivated_at IS NULL
                   AND EXISTS (
                     SELECT 1 FROM plugin_grants g
                      WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
                   -- Two members and no more. `kind` cannot be trusted for this.
                   AND (SELECT count(*) FROM channel_members m
                         WHERE m.channel_id = c.id) = 2
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id, "runtime": builtin.RUNTIME},
        )
    ).fetchone()
    if row is None:
        return None
    return Listener(
        plugin_id=row.id,
        slug=row.slug,
        name=row.name,
        bot_user_id=row.bot_user_id,
        agui_url=row.agui_url,
        signing_secret=row.signing_secret,
        runtime=row.runtime,
        workspace_name=row.workspace_name,
        owner_name=row.owner_name,
    )


@asynccontextmanager
async def _looks_busy(
    listener: Listener, channel_id: str, thread_root_id: str | None
) -> AsyncIterator[None]:
    """Show the agent typing for as long as it is thinking.

    Nothing reaches the client until an answer is *sealed* — `Fold` emits a post on
    TEXT_MESSAGE_END, not per delta — so a run is up to two minutes of an empty room. In
    a channel that reads as normal; in a DM, where the person is sitting there waiting,
    it is indistinguishable from the feature being broken.

    This costs no client change and no protocol change, because the typing indicator is
    already built, already broadcast per channel, and already rendered — the agent simply
    starts using the thing people use. It is re-armed inside the TTL rather than set once,
    since the indicator is deliberately short-lived so that a crashed client stops
    claiming somebody is typing forever.

    Failures are swallowed on purpose. A cosmetic indicator must never be able to stop an
    answer from being written.
    """
    interval = max(1.0, (TYPING_TTL_MS / 1000) * 0.6)

    async def signal() -> None:
        try:
            await presence.set_typing(channel_id, listener.bot_user_id, thread_root_id)
        except Exception:
            # A cosmetic indicator must never be able to stop an answer being written.
            log.debug("could not signal typing", exc_info=True)

    async def beat() -> None:
        while True:
            await asyncio.sleep(interval)
            await signal()

    # Signalled once here rather than only inside the task: `create_task` schedules, it
    # does not run, so against a fast model the whole run can finish before the loop gets
    # its first slot and the indicator would never appear at all. The person should see it
    # the moment the run starts, which is now.
    await signal()
    task = asyncio.create_task(beat())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


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
        listeners = (
            await listeners_for(
                session, workspace_id=trigger.workspace_id, mention_user_ids=mentioned
            )
            if mentioned
            else []
        )

        # A DM with the built-in agent is addressed by the room rather than by a mention:
        # there is nobody else in it, so making people type `@Blob` at a wall would be
        # ceremony. Slack's own assistant works this way and so does every DM anyone has
        # ever sent, which is the point — this is the Slack reflex, not a new one.
        personal = await personal_agent_for(
            session, workspace_id=trigger.workspace_id, channel_id=trigger.channel_id
        )
        if personal and all(known.plugin_id != personal.plugin_id for known in listeners):
            # Deduped because mentioning it *inside* its own DM is a thing people do out
            # of habit, and it must not answer twice for one message.
            listeners = [*listeners, personal]

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

    # Concurrent, not sequential: with a 120-second ceiling per run, a message that
    # mentions three agents used to answer in worst-case six minutes, and one hung
    # agent delayed every other agent's reply to the same message. `_run_one` already
    # contains each failure — an exception there posts the apology and returns.
    await asyncio.gather(
        *(
            _run_one(
                listener,
                workspace_id=trigger.workspace_id,
                channel_id=trigger.channel_id,
                thread_root_id=trigger.thread_root_id,
                trigger_id=trigger.id,
                trigger_user_id=trigger.author_id,
                asker=asker or "someone",
                channel_name=channel_name or "a conversation",
            )
            for listener in listeners
        ),
        return_exceptions=True,
    )


async def _run_one(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
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
        messages=agui.to_agui_messages(history, bot_user_id=listener.bot_user_id, names=names),
        channel_name=channel_name,
        trigger_user=asker,
    )

    # Written before the call, not after: a run that never returns — a process killed
    # mid-call, an agent that hangs past every timeout — is exactly the case with nothing
    # to show for it, and the `running` row is what says so.
    async with transaction() as (session, _):
        run_id = await agent_run_service.start(
            session,
            workspace_id=workspace_id,
            plugin_id=listener.plugin_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            trigger_message_id=trigger_id,
            trigger_user_id=trigger_user_id,
            transport=listener.transport,
        )

    async with _looks_busy(listener, channel_id, thread_root_id):
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
    # Four outcomes, matching what this function already does with them. Collapsing
    # `interrupted` into `failed` would lose the one an operator can act on, and
    # collapsing silence into failure would call a legitimate answer a fault.
    async with transaction() as (session, _):
        await agent_run_service.finish(
            session,
            run_id,
            status="failed" if reason else "interrupted" if fold.interrupt else "succeeded",
            error=reason,
            post_count=len(posts),
        )

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
