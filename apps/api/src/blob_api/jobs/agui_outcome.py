"""One agent, one run: from a mention that reached it to what it left behind.

The outcome half of `jobs/agui.py`. `run_one` is the sequence and each phase is its own
function: gather what the agent will be shown, refuse or start a run row, stream the
answer under the Stop button, post what it said, record how it ended, and say the
words that are Blob's rather than the agent's — the apology, the decision prompt.

No transaction is ever open across the HTTP call. The session that reads the history
is closed before the agent is contacted, and each message the agent produces commits
on its own, so a failure on the third answer cannot roll back the first two.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import queue as queue_lib
from ..lib.errors import AppError
from ..lib.redis import redis, redis_sub
from ..plugins import agui, decisions, run_card
from ..plugins import events as plugin_events
from ..plugins.streams import Listener, stream_run
from ..realtime import hub
from ..services import agent_chains
from ..services import agent_runs as agent_run_service
from ..services import agent_state as agent_state_service
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import work as work_service
from ..services.serialize import message_event
from .agui_admission import agent_tools, looks_busy
from .agui_stream import CardBroadcaster, wait_for_cancel

log = logging.getLogger("blob.jobs.agui")


def now_iso() -> str:
    from ..schemas.base import require_iso

    return require_iso(datetime.now(UTC))


def refused_view(
    run_id: str,
    listener: Listener,
    *,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    reason: str,
) -> dict[str, Any]:
    """A run that was over before it began, as the client draws it.

    `agent_run.started` announces that a run row exists, whatever its status — the
    client upserts the whole view, so a run terminal at birth needs no second event.
    The card under the mention is the refusal's whole voice: the agent posts no
    message, because the agent never ran.
    """
    return {
        "id": run_id,
        "pluginId": listener.plugin_id,
        "agentName": listener.name,
        "channelId": channel_id,
        "threadRootId": thread_root_id,
        "triggerMessageId": trigger_id,
        "status": "refused",
        "error": reason,
        "postCount": 0,
        "startedAt": now_iso(),
        "finishedAt": now_iso(),
        "card": None,
        "chainId": trigger_id,
        "parentRunId": None,
        "depth": 0,
        "askedBy": None,
        "answeredAt": None,
        "expiresAt": None,
    }


async def refuse(
    session: AsyncSession,
    after: Any,
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
    reason: str,
) -> None:
    """Record that this agent was not run, and show the card that says so."""
    refused_id = await agent_run_service.record_refusal(
        session,
        workspace_id=workspace_id,
        plugin_id=listener.plugin_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        trigger_message_id=trigger_id,
        trigger_user_id=trigger_user_id,
        transport=listener.transport,
        reason=reason,
    )
    view = refused_view(
        refused_id,
        listener,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        trigger_id=trigger_id,
        reason=reason,
    )
    after.add(lambda: hub.to_channel(channel_id, {"t": "agent_run.started", "run": view}))


@dataclass(slots=True)
class Gathered:
    """What one run will be shown, read in one session and closed before the call."""

    history: list[Any]
    names: dict[str, str]
    participants: list[str]
    state: Any
    thread_key: str
    #: Why the agent will not run at all, if it will not.
    refusal: str | None
    #: The bot cannot see or write here. It says nothing at all: a private channel
    #: answers 404 precisely so that its existence is not disclosed, and an app
    #: announcing "I can't read this" would disclose it.
    silent: bool = False


@dataclass(slots=True)
class Streamed:
    fold: agui.Fold
    posts: list[agui.Post]
    transport_error: str | None
    cancelled: bool


async def post_as_bot(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    body: str,
    client_msg_id: str,
    blocks: list[dict[str, Any]] | None,
    run_id: str | None = None,
    spawn: bool = False,
) -> str | None:
    """One message, the way the bot API posts one. Returns its id, or None if an earlier
    run of this job already posted it.

    Duplicated rather than shared for now because `jobs/` and `plugins/` may not import
    `routers/`; the tidy-up is for `bot_api` to adopt this, in a commit that is allowed
    to touch the `/api/v1/` contract.

    `spawn` is how a chain grows (ADR 0013). When this reply mentions somebody and the
    run it came from may extend its chain, the mention is handed to the run job with this
    run as the parent — the job decides whether the mentioned agent may actually go.
    Never for the apology or the decision prompt: those are Blob's words, and an agent
    must not be able to start a hop by failing.
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
            return None  # Already posted by an earlier run of this job.

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
            queue_lib.fire_and_forget(queue_lib.enqueue("notify", message.id))
            if spawn and run_id is not None and message.mention_user_ids:
                queue_lib.fire_and_forget(queue_lib.enqueue("agui_run", message.id, run_id))
            queue_lib.fire_and_forget(queue_lib.enqueue("deliver_plugin_events"))

        after.add(broadcast)
    return message.id


async def record_error(plugin_id: str, reason: str) -> None:
    async with transaction() as (session, _):
        await session.execute(
            text("UPDATE plugins SET last_error = :reason, updated_at = now() WHERE id = :id"),
            {"reason": reason[:500], "id": plugin_id},
        )


async def _gather(
    listener: Listener,
    *,
    channel_id: str,
    thread_root_id: str | None,
    chain: agent_chains.Chain,
) -> Gathered:
    thread_key = thread_root_id or channel_id
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
            return Gathered([], {}, [], None, thread_key, None, silent=True)

        # The budget answers here — after access, before anything is spent. A refused
        # mention skips the history read and the agent call both, and a bot that cannot
        # see the channel said nothing above rather than "over budget".
        refusal = await agent_run_service.check_budget(session, plugin_id=listener.plugin_id)
        if refusal is not None:
            history = []
        elif thread_root_id:
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
                    SELECT id, display_name, kind FROM users
                     WHERE id = ANY(cast(:ids AS uuid[]))
                    """
                ),
                {"ids": [m.author_id for m in history if m.author_id]},
            )
        ).fetchall()
        names: dict[str, str] = {row.id: row.display_name for row in rows}
        # The other agents in the room, so this one can address them. Its own name is
        # left out: an agent mentioning itself is dropped at admission anyway.
        participants = sorted(
            {
                row.display_name
                for row in rows
                if row.kind == "bot" and str(row.id) != listener.bot_user_id
            }
        )
        # What this agent remembers here. A resume carries the state the run had when it
        # stopped, which is newer than anything saved, so it wins; otherwise the last
        # state the agent left in this conversation is where it picks up.
        state = chain.state
        if state is None and refusal is None:
            state = await agent_state_service.load(
                session, plugin_id=listener.plugin_id, thread_key=thread_key
            )

    return Gathered(history, names, participants, state, thread_key, refusal)


async def _start(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
    chain: agent_chains.Chain,
) -> str:
    """The `running` row, written before the call and not after.

    A run that never returns — a process killed mid-call, an agent that hangs past every
    timeout — is exactly the case with nothing to show for it, and the row is what says
    so.
    """
    async with transaction() as (session, after):
        run_id = await agent_run_service.start(
            session,
            workspace_id=workspace_id,
            plugin_id=listener.plugin_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            trigger_message_id=trigger_id,
            trigger_user_id=trigger_user_id,
            transport=listener.transport,
            chain_id=chain.chain_id,
            initiated_by_user_id=chain.initiated_by_user_id,
            parent_run_id=chain.parent_run_id,
            depth=chain.depth,
        )
        run_view: dict[str, Any] = {
            "id": run_id,
            "pluginId": listener.plugin_id,
            "agentName": listener.name,
            "channelId": channel_id,
            "threadRootId": thread_root_id,
            "triggerMessageId": trigger_id,
            "status": "running",
            "error": None,
            "postCount": 0,
            "startedAt": now_iso(),
            "finishedAt": None,
            "card": None,
            "chainId": chain.chain_id,
            "parentRunId": chain.parent_run_id,
            "depth": chain.depth,
            "askedBy": chain.asked_by,
            "answeredAt": None,
            "expiresAt": None,
        }
        after.add(lambda: hub.to_channel(channel_id, {"t": "agent_run.started", "run": run_view}))

    return run_id


async def _stream(
    listener: Listener,
    run_input: Any,
    *,
    run_id: str,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    chain: agent_chains.Chain,
    card: run_card.CardFold,
) -> Streamed:
    """Run the agent under the Stop button, showing the card as it forms."""
    broadcaster = CardBroadcaster(run_id, channel_id, card)
    cancelled = False

    ctl_channel = f"agent:ctl:{run_id}"
    pubsub = redis_sub.pubsub()
    try:
        # Subscribe before reading the key, so a Stop pressed in the gap is caught by
        # whichever side it lands on — the recorded subscribe-before-publish rule.
        subscribed = False
        try:
            await pubsub.subscribe(ctl_channel)
            subscribed = True
        except Exception:
            log.warning("cancel watch unavailable for run %s", run_id, exc_info=True)
        already = None
        with suppress(Exception):
            already = await redis.get(f"agui:cancel:{run_id}")

        posts: list[agui.Post]
        if already:
            fold, posts, transport_error = agui.Fold(), [], None
            cancelled = True
        else:
            async with looks_busy(listener, channel_id, thread_root_id):
                tools, tool_runner = await agent_tools(
                    listener,
                    workspace_id=workspace_id,
                    user_id=chain.initiated_by_user_id,
                )
                stream_task = asyncio.create_task(
                    stream_run(
                        listener,
                        run_input,
                        on_event=broadcaster.on_event,
                        tools=tools,
                        call=tool_runner,
                    )
                )
                waiters: set[asyncio.Task[Any]] = {stream_task}
                cancel_task: asyncio.Task[None] | None = None
                if subscribed:
                    cancel_task = asyncio.create_task(wait_for_cancel(pubsub))
                    waiters.add(cancel_task)
                done, _pending = await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
                if cancel_task is not None and cancel_task in done and stream_task not in done:
                    stream_task.cancel()
                    cancelled = True
                if cancel_task is not None:
                    cancel_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await cancel_task
                try:
                    fold, posts, transport_error = await stream_task
                except asyncio.CancelledError:
                    fold, posts, transport_error = agui.Fold(), [], None
                if cancelled:
                    # Sealed-but-unposted answers die with the run: the person asked
                    # for it to stop, and a reply landing after Stop reads as defiance.
                    posts = []
                    transport_error = None
    finally:
        await broadcaster.stop()
        with suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]

    return Streamed(fold, posts, transport_error, cancelled)


async def _finish(
    listener: Listener,
    streamed: Streamed,
    *,
    run_id: str,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    thread_key: str,
    card: run_card.CardFold,
    post_count: int,
) -> tuple[agent_run_service.RunStatus, str | None, agui.Decision | None]:
    """How the run ended, on the row and on the channel.

    Five outcomes, matching what this job already does with them. Collapsing
    `interrupted` into `failed` would lose the one an operator can act on, and
    collapsing silence into failure would call a legitimate answer a fault.
    """
    fold, cancelled = streamed.fold, streamed.cancelled
    reason = streamed.transport_error or fold.error
    status: agent_run_service.RunStatus = (
        "cancelled"
        if cancelled
        else "failed"
        if reason
        else "interrupted"
        if fold.interrupt
        else "succeeded"
    )
    final_card = card.snapshot() if card.has_content else None

    decision: agui.Decision | None = None
    expires_at: datetime | None = None
    if status == "interrupted":
        decision = agui.decision_of(fold.interrupts)
        expires_at = datetime.now(UTC) + timedelta(seconds=agent_chains.INTERRUPT_TTL_SEC)
        if decision.expires_at is not None and decision.expires_at < expires_at:
            expires_at = decision.expires_at

    shared_state = (
        json.dumps(fold.state, default=str)
        if not fold.state_dropped and fold.state is not None
        else None
    )
    async with transaction() as (session, after):
        await agent_run_service.finish(
            session,
            run_id,
            status=status,
            error=reason,
            post_count=post_count,
            card=final_card,
            interrupt=fold.interrupts if status == "interrupted" else None,
            state_json=shared_state if status == "interrupted" else None,
            expires_at=expires_at,
        )
        if shared_state is not None and status in ("succeeded", "interrupted"):
            # Kept past the run, per conversation: the next run here starts from it. A
            # failed or stopped run leaves the memory as it was — what it had folded
            # was never the agent's considered state.
            await agent_state_service.save(
                session,
                workspace_id=workspace_id,
                plugin_id=listener.plugin_id,
                thread_key=thread_key,
                state_json=shared_state,
            )
        if fold.artifacts and status in ("succeeded", "interrupted"):
            # What the agent made, into the work this channel is — if it is one. Elsewhere
            # the events were inert, on purpose: an artifact needs the tabs to be seen in.
            work = await work_service.by_channel(session, channel_id)
            if work is not None and work.status == "open":
                for made in fold.artifacts:
                    await work_service.publish(
                        session,
                        work_id=work.id,
                        kind=made["kind"],
                        title=made["title"],
                        body=made["body"],
                        author_user_id=listener.bot_user_id,
                        run_id=run_id,
                    )
                updated = await work_service.get(session, work.id, workspace_id)
                work_update = {
                    "t": "work.updated",
                    "workId": updated.id,
                    "channelId": channel_id,
                    "status": updated.status,
                    "artifactCount": updated.artifact_count,
                }
                after.add(lambda: hub.to_channel(channel_id, work_update))
        finished_event = {
            "t": "agent_run.finished",
            "runId": run_id,
            "channelId": channel_id,
            "status": status,
            "error": reason,
            "postCount": post_count,
        }
        after.add(lambda: hub.to_channel(channel_id, finished_event))
        if final_card is not None:
            # One last snapshot with the final fold, so the finished card is whole
            # even when the run ended between throttle ticks.
            after.add(
                lambda: hub.to_channel(
                    channel_id,
                    {
                        "t": "agent_run.updated",
                        "runId": run_id,
                        "channelId": channel_id,
                        "card": final_card,
                    },
                )
            )
        if status == "interrupted":
            # The finished event has no room for `expiresAt`; the started event is an
            # upsert of the whole view, and the client renders the deadline from it.
            waiting_view = await agent_run_service.view_of(session, run_id)
            if waiting_view is not None:
                after.add(
                    lambda: hub.to_channel(
                        channel_id, {"t": "agent_run.started", "run": waiting_view}
                    )
                )

    return status, reason, decision


async def run_one(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
    asker: str,
    channel_name: str,
    chain: agent_chains.Chain,
    max_depth: int,
    on_behalf_of: str | None,
) -> None:
    gathered = await _gather(
        listener, channel_id=channel_id, thread_root_id=thread_root_id, chain=chain
    )
    if gathered.silent:
        return
    if gathered.refusal is not None:
        async with transaction() as (session, after):
            await refuse(
                session,
                after,
                listener,
                workspace_id=workspace_id,
                channel_id=channel_id,
                thread_root_id=thread_root_id,
                trigger_id=trigger_id,
                trigger_user_id=trigger_user_id,
                reason=gathered.refusal,
            )
        return

    run_input = agui.build_run_input(
        thread_id=thread_root_id or channel_id,
        run_id=trigger_id,
        messages=agui.to_agui_messages(
            gathered.history, bot_user_id=listener.bot_user_id, names=gathered.names
        ),
        channel_name=channel_name,
        trigger_user=asker,
        asked_by_agent=chain.asked_by,
        on_behalf_of=on_behalf_of,
        participants=gathered.participants,
        state=gathered.state,
        parent_run_id=chain.parent_agui_run_id,
        resume=chain.resume,
    )
    run_id = await _start(
        listener,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        trigger_id=trigger_id,
        trigger_user_id=trigger_user_id,
        chain=chain,
    )
    card = run_card.CardFold()
    streamed = await _stream(
        listener,
        run_input,
        run_id=run_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        chain=chain,
        card=card,
    )

    # Whether a reply from this run may carry the chain a hop further. Decided once, here,
    # from the depth budget; the job that picks the hop up applies the rest of the rules.
    spawn = agent_chains.can_spawn(chain, max_depth)
    for post in streamed.posts:
        await post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=post.body,
            client_msg_id=post.client_msg_id(trigger_id),
            blocks=post.blocks(),
            run_id=run_id,
            spawn=spawn,
        )

    _status, reason, decision = await _finish(
        listener,
        streamed,
        run_id=run_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        thread_key=gathered.thread_key,
        card=card,
        post_count=len(streamed.posts),
    )
    if streamed.cancelled:
        return  # Stopped on request; no apology, nothing posted.

    if reason:
        await record_error(listener.plugin_id, reason)
        await post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=f"I couldn't finish that — {reason}.",
            client_msg_id=f"agui:{trigger_id}:error",
            blocks=None,
        )
    elif decision is not None:
        decision_message_id = await post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=f"Needs a decision: {decision.prompt}",
            client_msg_id=f"agui:{trigger_id}:interrupt",
            blocks=decisions.decision_blocks(run_id, decision),
        )
        if decision_message_id is not None:
            async with transaction() as (session, _after):
                await agent_run_service.set_decision_message(session, run_id, decision_message_id)
    # A run that finished cleanly and said nothing posts nothing. Silence is a legitimate
    # answer, and "the agent had no reply" is worse noise than no reply.
