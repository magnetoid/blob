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
import time
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
from ..lib.ids import new_id
from ..lib.redis import redis, redis_sub
from ..plugins import agui, decisions, run_card
from ..plugins import events as plugin_events
from ..plugins.streams import Listener, stream_run
from ..realtime import hub
from ..services import agent_chains, agent_files, task_dispatch
from ..services import agent_runs as agent_run_service
from ..services import agent_state as agent_state_service
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import work as work_service
from ..services.serialize import message_event
from . import agui_tools
from .agui_admission import looks_busy
from .agui_input import attachment_parts
from .agui_stream import CardBroadcaster, wait_for_cancel

log = logging.getLogger("blob.jobs.agui")


#: How much of a thread an agent is shown when it is asked inside one: the root, and
#: this many of the newest replies. The ceiling `messages.thread` has always had, now
#: keeping the end of a long thread — where the question is — rather than its start.
THREAD_HISTORY_LIMIT = 1000

#: On the card when the worker stopped under a run — a deploy restarting it, or arq's
#: own ceiling. Not the agent's fault, so it is not written to the agent's `last_error`.
STOPPED_MID_RUN = "Blob restarted while the agent was answering. Ask again."
#: On the card when something inside Blob failed after the run began.
FAILED_INSIDE_BLOB = "Blob could not finish writing this run's answer."


def now_iso() -> str:
    from ..schemas.base import require_iso

    return require_iso(datetime.now(UTC))


def _being_cancelled() -> bool:
    """Whether the task running this is itself being cancelled, as opposed to a task it
    was awaiting having been cancelled by somebody else (the Stop button)."""
    current = asyncio.current_task()
    return current is not None and current.cancelling() > 0


def refused_view(
    run_id: str,
    listener: Listener,
    *,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
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
        "initiatedByUserId": trigger_user_id,
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
    chain_id: str | None = None,
) -> None:
    """Record that this agent was not run, and show the card that says so — and, when the
    run was a task's (ADR 0023), block the task with the reason."""
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
        trigger_user_id=trigger_user_id,
        reason=reason,
    )
    after.add(lambda: hub.to_channel(channel_id, {"t": "agent_run.started", "run": view}))
    if chain_id is not None:
        await task_dispatch.settle(
            session,
            after,
            chain_id=chain_id,
            plugin_id=listener.plugin_id,
            status="refused",
            reason=reason,
        )


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
    #: Whose memory this run reads and writes — None for the conversation's, a person
    #: for theirs (`Listener.memory_of`, migration 0050).
    memory_person: str | None = None
    #: The task this run was handed, as the run input's `task` context item says it — or
    #: None, which is nearly every run (ADR 0023).
    task: dict[str, Any] | None = None


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
    attachment_ids: list[str] | None = None,
    mention_user_ids: list[str] | None = None,
) -> str | None:
    """One message, the way the bot API posts one. Returns its id, or None if an earlier
    run of this job already posted it.

    `attachment_ids` are files the run handed over, already stored and owned by the bot
    (`services/agent_files.py`). A repeat of this job posts nothing and binds nothing, so
    its copies stay unbound and the orphan sweep takes them.

    Duplicated rather than shared for now because `jobs/` and `plugins/` may not import
    `routers/`; the tidy-up is for `bot_api` to adopt this, in a commit that is allowed
    to touch the `/api/v1/` contract.

    `spawn` is how a chain grows (ADR 0013). When this reply mentions somebody and the
    run it came from may extend its chain, the mention is handed to the run job with this
    run as the parent — the job decides whether the mentioned agent may actually go.
    Never for the apology or the decision prompt: those are Blob's words, and an agent
    must not be able to start a hop by failing.

    `mention_user_ids` sets the message's mentions outright, for Blob's own words — the
    decision prompt mentions the person it waits on, whatever its text says.
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
            attachment_ids=attachment_ids,
            mention_user_ids=mention_user_ids,
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
            history = await message_service.thread_tail(
                session, thread_root_id, limit=THREAD_HISTORY_LIMIT
            )
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
        memory_person = listener.memory_of(chain.initiated_by_user_id)
        if state is None and refusal is None:
            state = await agent_state_service.load(
                session,
                plugin_id=listener.plugin_id,
                thread_key=thread_key,
                person_id=memory_person,
            )
        task = (
            await task_dispatch.for_run(
                session, chain_id=chain.chain_id, bot_user_id=listener.bot_user_id
            )
            if refusal is None
            else None
        )

    return Gathered(
        history,
        names,
        participants,
        state,
        thread_key,
        refusal,
        memory_person=memory_person,
        task=task,
    )


async def _start(
    listener: Listener,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_id: str,
    trigger_user_id: str | None,
    chain: agent_chains.Chain,
) -> str | None:
    """The `running` row, written before the call and not after — or None when this
    trigger already ran this agent, which is the ledger saying a job came twice.

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
        if run_id is None:
            return None
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
            "initiatedByUserId": chain.initiated_by_user_id,
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
    wall_sec: float | None = None,
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
                stream_task = asyncio.create_task(
                    stream_run(
                        listener, run_input, on_event=broadcaster.on_event, wall_sec=wall_sec
                    )
                )
                waiters: set[asyncio.Task[Any]] = {stream_task}
                cancel_task: asyncio.Task[None] | None = None
                if subscribed:
                    cancel_task = asyncio.create_task(wait_for_cancel(pubsub))
                    waiters.add(cancel_task)
                try:
                    done, _pending = await asyncio.wait(
                        waiters, return_when=asyncio.FIRST_COMPLETED
                    )
                except BaseException:
                    # This job is being cancelled itself — a restart, arq's ceiling.
                    # `asyncio.wait` does not cancel what it waits on, so without this
                    # the stream kept talking to the agent for nobody, and the Stop
                    # watcher polled a closed pubsub once a second for ever.
                    for task in waiters:
                        task.cancel()
                    raise
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
                    if _being_cancelled():
                        # Not the Stop button: the job itself is going away. Let it.
                        raise
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
    memory_person: str | None,
    sent_1_0: bool = False,
    approval: dict[str, Any] | None = None,
    bound_error: str | None = None,
    usage: list[dict[str, Any]] | None = None,
    state_touched: bool | None = None,
    exchange: list[dict[str, Any]] | None = None,
    chain_id: str | None = None,
    answer: str | None = None,
    seen: dict[str, Any] | None = None,
) -> tuple[agent_run_service.RunStatus, str | None, agui.Decision | None]:
    """How the run ended, on the row and on the channel.

    Five outcomes, matching what this job already does with them. Collapsing
    `interrupted` into `failed` would lose the one an operator can act on, and
    collapsing silence into failure would call a legitimate answer a fault.

    A run that used Blob's tools streamed more than once, and `streamed` is its last
    round: `usage` and `state_touched` say what all of them added up to. `approval` is a
    write it asked Blob to make, waiting for the person (ADR 0022) — it stops the run the
    way the agent's own question does, with the question minted by Blob. `bound_error` is
    a limit of the tool loop that ended it.

    A run handed a task (ADR 0023) moves that task in the same transaction, by `answer` —
    everything it said, across every round. `seen` is what the run was shown, kept on it.
    """
    fold, cancelled = streamed.fold, streamed.cancelled
    reason = streamed.transport_error or fold.error or bound_error
    interrupt_items = approval["items"] if approval is not None else fold.interrupts
    touched = fold.state_touched if state_touched is None else state_touched
    status: agent_run_service.RunStatus = (
        "cancelled"
        if cancelled
        else "failed"
        if reason
        else "interrupted"
        if approval is not None or fold.interrupt
        # The agent ended the run as cancelled itself — after Blob's cancel frame, or its
        # own decision. Neither an answer nor a failure, and the card should not say
        # either.
        else "cancelled"
        if fold.cancelled
        else "succeeded"
    )
    # The row keeps no draft: what was finished is posted, and what was not never was the
    # agent's answer.
    final_card = card.snapshot(final=True) if card.has_content else None

    decision: agui.Decision | None = None
    expires_at: datetime | None = None
    if status == "interrupted":
        decision = agui.decision_of(interrupt_items)
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
            interrupt=interrupt_items if status == "interrupted" else None,
            interrupt_extra=(
                {key: value for key, value in approval.items() if key != "items"}
                if approval is not None and status == "interrupted"
                # The agent's own question after some tool rounds: keep the rounds, so the
                # run that resumes it is handed the history as it happened.
                else {"exchange": agui_tools.trim_exchange(exchange)}
                if exchange and status == "interrupted"
                else None
            ),
            state_json=shared_state if status == "interrupted" else None,
            expires_at=expires_at,
            usage=fold.usage if usage is None else (usage or None),
            seen=seen,
        )
        if chain_id is not None:
            await task_dispatch.settle(
                session,
                after,
                chain_id=chain_id,
                plugin_id=listener.plugin_id,
                status=status,
                reason=reason,
                answer=answer,
            )
        if fold.protocol_version is not None and fold.protocol_version != listener.agui_version:
            # What the agent says it speaks, kept for its next run (migration 0046).
            await agent_run_service.learn_version(
                session, listener.plugin_id, fold.protocol_version
            )
        elif sent_1_0 and fold.rejected_status in (400, 422):
            # Refused outright a run written in 1.0: most likely redeployed on an older
            # SDK, which refuses the fields before it can say what it speaks. The next
            # run goes out in the older shape.
            await agent_run_service.forget_version(session, listener.plugin_id)
        if touched and shared_state is not None and status in ("succeeded", "interrupted"):
            # Kept past the run, per conversation — and per person for an agent somebody
            # owns: the next run here, for them, starts from it. A failed or stopped run
            # leaves the memory as it was — what it had folded was never the agent's
            # considered state — and so does a run that said nothing about state: the
            # fold starts from what it was given, and writing that back would only be a
            # second copy of it.
            await agent_state_service.save(
                session,
                workspace_id=workspace_id,
                plugin_id=listener.plugin_id,
                channel_id=channel_id,
                thread_key=thread_key,
                person_id=memory_person,
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
        # Nothing said in the room, for the reason `Gathered.silent` gives. A task handed
        # to this agent is still told, though: it was checked into this channel when it
        # was handed over, so the room it sits in already knows the agent was here, and
        # a task left "in progress" for an agent that can never answer helps nobody.
        async with transaction() as (session, after):
            await task_dispatch.settle(
                session,
                after,
                chain_id=chain.chain_id,
                plugin_id=listener.plugin_id,
                status="refused",
                reason="it can no longer post in this channel.",
            )
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
                chain_id=chain.chain_id,
            )
        return

    run_id = await _start(
        listener,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        trigger_id=trigger_id,
        trigger_user_id=trigger_user_id,
        chain=chain,
    )
    if run_id is None:
        # This trigger already ran this agent: the job was delivered twice. The run row
        # is the ledger (`agent_runs.start`), so the agent is not asked again.
        log.info(
            "agui: %s already answered %s; not running it twice", listener.plugin_id, trigger_id
        )
        return

    # From here a row says `running`, and something has to close it. `_finish` does for
    # every run that gets that far; the two ways a run can stop short of it are caught
    # here — this job being cancelled under the run (a deploy restarting the worker, arq's
    # own ceiling) and an exception inside Blob — and either used to leave the card under
    # the person's message spinning until the nightly sweep. `asyncio.gather` in
    # `jobs/agui.py` would have swallowed the exception besides, so it was not even logged.
    progress = _Progress()
    asked = _Asked(
        trigger_id=trigger_id,
        asker=asker,
        channel_name=channel_name,
        on_behalf_of=on_behalf_of,
    )
    try:
        await _drive(
            listener,
            gathered,
            asked,
            progress,
            run_id=run_id,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            thread_key=gathered.thread_key,
            memory_person=gathered.memory_person,
            chain=chain,
            max_depth=max_depth,
        )
    except asyncio.CancelledError:
        if not progress.finished:
            with suppress(Exception):
                await asyncio.shield(
                    _abandon(
                        run_id,
                        channel_id=channel_id,
                        reason=STOPPED_MID_RUN,
                        post_count=progress.posted,
                        chain_id=chain.chain_id,
                        plugin_id=listener.plugin_id,
                    )
                )
        raise
    except Exception:
        log.exception("agui: run %s for %s failed inside Blob", run_id, listener.plugin_id)
        if not progress.finished:
            with suppress(Exception):
                await _abandon(
                    run_id,
                    channel_id=channel_id,
                    reason=FAILED_INSIDE_BLOB,
                    post_count=progress.posted,
                    chain_id=chain.chain_id,
                    plugin_id=listener.plugin_id,
                )


@dataclass(slots=True)
class _Progress:
    """How far a run got, for the handler that closes one which stopped short."""

    #: Answers posted so far.
    posted: int = 0
    #: `_finish` has written the run's outcome; nothing left for a handler to close.
    finished: bool = False


async def _abandon(
    run_id: str,
    *,
    channel_id: str,
    reason: str,
    post_count: int,
    chain_id: str | None = None,
    plugin_id: str | None = None,
) -> None:
    """Close a run that will not reach `_finish`, and tell the channel it ended — and the
    task it was handed, if it was handed one."""
    async with transaction() as (session, after):
        closed = await agent_run_service.abandon(
            session, run_id, reason=reason, post_count=post_count
        )
        if closed and chain_id is not None and plugin_id is not None:
            await task_dispatch.settle(
                session,
                after,
                chain_id=chain_id,
                plugin_id=plugin_id,
                status="failed",
                reason=reason,
            )
        if closed:
            finished_event = {
                "t": "agent_run.finished",
                "runId": run_id,
                "channelId": channel_id,
                "status": "failed",
                "error": reason,
                "postCount": post_count,
            }
            after.add(lambda: hub.to_channel(channel_id, finished_event))


@dataclass(slots=True)
class _Asked:
    """Who asked, and where — what the run input says about the question."""

    trigger_id: str
    asker: str
    channel_name: str
    on_behalf_of: str | None


async def _base_messages(
    listener: Listener, gathered: Gathered
) -> tuple[list[dict[str, Any]], bool, int]:
    """The conversation as the run is shown it, whether it is written in AG-UI 1.0, and
    how many files went with it.

    Read once per run, after the run row exists: the files are storage round trips, and
    a job delivered twice should stop at the ledger before doing them — and a failure
    here should close the run like any other, which only `run_one`'s guard does.

    AG-UI 1.0's input fields go only to an agent that has said it speaks 1.0: an older
    parser refuses a member it does not know, and that refusal looks like the agent being
    down.
    """
    speaks_1_0 = agui.speaks(listener.agui_version)
    parts = (
        await attachment_parts(gathered.history, bot_user_id=listener.bot_user_id)
        if speaks_1_0
        else None
    )
    messages = agui.to_agui_messages(
        gathered.history, bot_user_id=listener.bot_user_id, names=gathered.names, parts=parts
    )
    files = sum(len(given) for given in parts.values()) if parts else 0
    return messages, speaks_1_0, files


def _run_body(
    listener: Listener,
    gathered: Gathered,
    asked: _Asked,
    *,
    messages: list[dict[str, Any]],
    carried: list[dict[str, Any]],
    exchange: list[dict[str, Any]],
    state: Any,
    speaks_1_0: bool,
    first: bool,
    tools: list[dict[str, Any]],
    channel_id: str,
    thread_root_id: str | None,
    chain: agent_chains.Chain,
) -> dict[str, Any]:
    """One round's POST body.

    The first round is the run as it always was. A later round carries on after Blob ran
    the tools the agent called (ADR 0022): the same conversation, the tool exchange so far
    appended as AG-UI history — the agent's turns with their calls, then the results — a
    fresh `runId`, and the state the last round left. `resume` and `parentRunId` belong to
    the round that answers a question, which is only ever the first.

    `carried` is the exchange of the run this one resumes, and goes where it happened:
    right after the message that run was answering, before its question and the
    person's answer. `exchange` is this run's own rounds, which come after both.
    """
    return agui.build_run_input(
        thread_id=thread_root_id or channel_id,
        run_id=asked.trigger_id if first and chain.tool_resume is None else new_id(),
        messages=[*_after(messages, chain.exchange_after, carried), *exchange],
        channel_name=asked.channel_name,
        trigger_user=asked.asker,
        asked_by_agent=chain.asked_by,
        on_behalf_of=asked.on_behalf_of,
        participants=gathered.participants,
        state=state,
        parent_run_id=chain.parent_agui_run_id if first else None,
        resume=chain.resume if first else None,
        instructions=listener.instructions,
        protocol_version=agui.PROTOCOL_VERSION if speaks_1_0 else None,
        tools=tools,
        task=gathered.task,
    )


def _after(
    messages: list[dict[str, Any]], anchor: str | None, carried: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """`messages` with `carried` placed right after the one with id `anchor` — or at the
    end, when there is no anchor or it has scrolled out of what the run is shown."""
    if not carried:
        return messages
    for index, message in enumerate(messages):
        if anchor is not None and message.get("id") == anchor:
            return [*messages[: index + 1], *carried, *messages[index + 1 :]]
    return [*messages, *carried]


@dataclass(slots=True)
class _Tools:
    """What one run may do with Blob's tools, decided once, as the run begins."""

    names: frozenset[str]
    caller: Any = None


async def _tools_for(
    listener: Listener, chain: agent_chains.Chain, *, channel_id: str, workspace_id: str
) -> _Tools:
    """The tools this run may call, and the person they run as, inside the room."""
    names = agui_tools.offered_names(listener.tool_access)
    if not names:
        return _Tools(frozenset())
    room = await agui_tools.room_for(
        channel_id=channel_id,
        bot_user_id=listener.bot_user_id,
        person_id=chain.initiated_by_user_id,
    )
    caller = await agui_tools.caller_for(
        workspace_id=workspace_id,
        person_id=chain.initiated_by_user_id,
        room_channel_id=room,
    )
    # The person the run is on behalf of is gone: there is nobody to read as.
    return _Tools(names, caller) if caller is not None else _Tools(frozenset())


async def _drive(
    listener: Listener,
    gathered: Gathered,
    asked: _Asked,
    progress: _Progress,
    *,
    run_id: str,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    thread_key: str,
    memory_person: str | None,
    chain: agent_chains.Chain,
    max_depth: int,
) -> None:
    """A started run: stream it, run the tools it called, post what it said, finish.

    Without Blob's tools this is one round, as it always was. With them (ADR 0022) a round
    that ends on calls to them is followed by another carrying the results, until the agent
    answers without calling one, stops to ask, has a write to wait on, or a bound ends it —
    `MAX_TOOL_ROUNDS`, or the run's wall clock, which covers every round.
    """
    messages, sent_1_0, files = await _base_messages(listener, gathered)
    tools = await _tools_for(listener, chain, channel_id=channel_id, workspace_id=workspace_id)
    # What this run is shown, kept on it when it ends: counts and names, never content.
    seen: dict[str, Any] = {
        "messages": len(gathered.history),
        "window": "thread" if thread_root_id else "channel",
        "files": files,
        "instructions": bool(listener.instructions),
        "memory": gathered.state is not None,
        "task": gathered.task is not None,
        "tools": sorted(tools.names),
        "protocol": agui.PROTOCOL_VERSION if sent_1_0 else None,
    }
    deadline = time.monotonic() + settings.AGUI_MAX_RUN_SEC
    card = run_card.CardFold(show_reasoning=listener.shows_reasoning)
    # Whether a reply from this run may carry the chain a hop further. Decided once, here,
    # from the depth budget; the job that picks the hop up applies the rest of the rules.
    spawn = agent_chains.can_spawn(chain, max_depth)

    # What the run this one resumes had already exchanged, and this run's own rounds.
    carried: list[dict[str, Any]] = list(chain.exchange)
    exchange: list[dict[str, Any]] = []
    round_no = 0
    if chain.tool_resume is not None:
        # The person answered a write the agent asked for. It is run (or declined) first,
        # and the run carries on from the turn that asked for it.
        carried, round_no = await _settle_approval(
            listener,
            chain.tool_resume,
            tools,
            run_id=run_id,
            workspace_id=workspace_id,
            sent_1_0=sent_1_0,
        )

    # Offered only when there is somebody to run them as: tools listed to an agent whose
    # calls could never run would be a promise the run cannot keep.
    offered = agui_tools.offered_for(tools.names)
    state = gathered.state
    touched = False
    usage: list[dict[str, Any]] = []
    approval: dict[str, Any] | None = None
    bound_error: str | None = None
    # Everything the agent said, every round: a task's outcome is its whole answer.
    said_in_all: list[str] = []
    while True:
        run_input = _run_body(
            listener,
            gathered,
            asked,
            messages=messages,
            carried=carried,
            exchange=exchange,
            state=state,
            speaks_1_0=sent_1_0,
            first=round_no == 0 and chain.tool_resume is None,
            tools=offered,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            chain=chain,
        )
        streamed = await _stream(
            listener,
            run_input,
            run_id=run_id,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            chain=chain,
            card=card,
            wall_sec=max(1.0, deadline - time.monotonic()),
        )
        # A later round's posts are keyed by their round too: each round's fold numbers
        # its posts from one.
        key = run_id if round_no == 0 else f"{run_id}:{round_no}"
        await _post_round(
            listener,
            streamed,
            progress,
            key=key,
            run_id=run_id,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            spawn=spawn,
        )
        said_in_all.extend(post.body for post in streamed.posts if post.body)
        if card.posted():
            # What the agent wrote is in the channel now, so its draft leaves the card —
            # sent once more, because the stream that would have carried it has ended.
            hub.to_channel(
                channel_id,
                {
                    "t": "agent_run.updated",
                    "runId": run_id,
                    "channelId": channel_id,
                    "card": card.snapshot(),
                },
            )
        fold = streamed.fold
        usage.extend(fold.usage or [])
        touched = touched or fold.state_touched
        if not fold.state_dropped:
            state = fold.state

        calls = fold.client_calls(tools.names) if tools.names else []
        if (
            not calls
            or streamed.cancelled
            or streamed.transport_error
            or fold.error
            or fold.interrupt
        ):
            break
        if round_no + 1 >= agui_tools.MAX_TOOL_ROUNDS:
            bound_error = f"the agent called tools in more than {agui_tools.MAX_TOOL_ROUNDS} rounds"
            break
        if time.monotonic() >= deadline:
            bound_error = "the agent ran past the ceiling"
            break

        # What the agent said this round is its turn's text: the history it is handed
        # next has to read as it happened, words and calls together.
        said = "\n\n".join(post.body for post in streamed.posts if post.body) or None
        turn, results, pending = await _run_calls(
            listener, calls, tools, card=card, sent_1_0=sent_1_0, said=said
        )
        exchange = [*exchange, turn, *results]
        if pending is not None:
            call, prepared, later = pending
            approval = {
                "items": [agui_tools.approval_item(listener.name, call, prepared)],
                "kind": "tool_approval",
                "call": {"id": call.id, "name": call.name, "arguments": call.arguments},
                "prepared": prepared.as_dict(),
                "later": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in later],
                "exchange": agui_tools.trim_exchange([*carried, *exchange]),
                "round": round_no,
            }
            break
        round_no += 1

    _status, reason, decision = await _finish(
        listener,
        streamed,
        run_id=run_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        thread_key=thread_key,
        card=card,
        post_count=progress.posted,
        memory_person=memory_person,
        sent_1_0=sent_1_0,
        approval=approval,
        bound_error=bound_error,
        usage=usage,
        state_touched=touched,
        exchange=[*carried, *exchange],
        chain_id=chain.chain_id,
        answer="\n\n".join(said_in_all) or None,
        seen=seen,
    )
    progress.finished = True
    if streamed.cancelled:
        return  # Stopped on request; no apology, nothing posted.

    if reason:
        # The card under the asker's message already says failed, and why — `_finish`
        # wrote the reason onto the run. This used to post it a second time as a message
        # from the agent ("I couldn't finish that — …"), and two copies of one failure a
        # few lines apart read as a bug of their own (2026-09-18). The plugin's
        # `last_error` still records it, which is what the console shows.
        await record_error(listener.plugin_id, reason)
    elif decision is not None:
        # Addressed to the person it waits on, by name and as a mention, so it reaches
        # them as one: a question asked in a busy channel used to sit there until they
        # happened to look, and expire with the day.
        decider = asked.on_behalf_of or asked.asker
        decision_message_id = await post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=f"Needs a decision from @{decider}: {decision.prompt}",
            client_msg_id=f"agui:{run_id}:interrupt",
            blocks=decisions.decision_blocks(run_id, decision),
            mention_user_ids=[chain.initiated_by_user_id],
        )
        if decision_message_id is not None:
            async with transaction() as (session, _after):
                await agent_run_service.set_decision_message(session, run_id, decision_message_id)
    # A run that finished cleanly and said nothing posts nothing. Silence is a legitimate
    # answer, and "the agent had no reply" is worse noise than no reply.


async def _post_round(
    listener: Listener,
    streamed: Streamed,
    progress: _Progress,
    *,
    key: str,
    run_id: str,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    spawn: bool,
) -> None:
    """Post what one round said."""
    for post in streamed.posts:
        # What the agent handed over rides on the answer it came with. Stored first,
        # outside any transaction — it is storage round trips — and anything refused
        # becomes a line under the answer rather than a file that silently is not there.
        stored = await agent_files.store(
            workspace_id=workspace_id, uploader_id=listener.bot_user_id, files=post.files
        )
        post.notes.extend(stored.notes)
        await post_as_bot(
            listener,
            workspace_id=workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            body=post.body,
            client_msg_id=post.client_msg_id(key),
            blocks=post.blocks(),
            run_id=run_id,
            spawn=spawn,
            attachment_ids=stored.attachment_ids,
        )
        progress.posted += 1


async def _run_calls(
    listener: Listener,
    calls: list[agui.ToolCall],
    tools: _Tools,
    *,
    card: run_card.CardFold,
    sent_1_0: bool,
    said: str | None,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    tuple[agui.ToolCall, agui_tools.PreparedWrite, list[agui.ToolCall]] | None,
]:
    """Run one round's calls: the reads at once, a write only up to the person.

    Answers the agent's turn as history, the results so far, and — when a write needs the
    person — that write, checked, with the calls after it, which wait with it. Every call
    the turn holds gets a result in the end: a model refuses a history with one missing.
    """
    turn = agui_tools.assistant_turn(calls, said)
    results: list[dict[str, Any]] = []
    for index, call in enumerate(calls):
        if index >= agui_tools.MAX_CALLS_PER_ROUND:
            outcome = agui_tools.not_run(
                f"one turn runs at most {agui_tools.MAX_CALLS_PER_ROUND} calls"
            )
        elif call.name in agui_tools.WRITE_TOOLS:
            prepared = await agui_tools.prepare_write(
                tools.caller, call, bot_user_id=listener.bot_user_id
            )
            if isinstance(prepared, agui_tools.PreparedWrite):
                later = list(calls[index + 1 :])
                return turn, results, (call, prepared, later)
            outcome = prepared
        else:
            outcome = await agui_tools.run_read(tools.caller, call)
        # On the card too: what each call came back with, for the people reading along.
        card.feed({"type": "TOOL_CALL_RESULT", "toolCallId": call.id, "content": outcome.summary})
        results.append(agui_tools.tool_message(call.id, outcome, speaks_1_0=sent_1_0))
    return turn, results, None


async def _settle_approval(
    listener: Listener,
    resumed: agent_chains.ToolResume,
    tools: _Tools,
    *,
    run_id: str,
    workspace_id: str,
    sent_1_0: bool,
) -> tuple[list[dict[str, Any]], int]:
    """Run or decline the write the person answered, and answer the calls that waited
    behind it. Returns the exchange to carry on from, and the round to carry on in."""
    call_id = str(resumed.call.get("id") or "")
    prepared = agui_tools.PreparedWrite.from_dict(resumed.prepared)
    if not resumed.approved:
        outcome = agui_tools.DECLINED
    elif prepared is None or tools.caller is None or "post_message" not in tools.names:
        # Asked when the agent could write; since then its access, or the person, is gone.
        outcome = agui_tools.ToolOutcome("", "Approved, but it can no longer be posted.")
    else:

        async def post(target: str, thread_root_id: str | None, body: str, key: str) -> str | None:
            # As the agent — it is the agent speaking — and never a hop: a message Blob
            # posted for a tool call starts no run (ADR 0022).
            return await post_as_bot(
                listener,
                workspace_id=workspace_id,
                channel_id=target,
                thread_root_id=thread_root_id,
                body=body,
                client_msg_id=key,
                blocks=None,
                spawn=False,
            )

        outcome = await agui_tools.run_write(
            tools.caller,
            prepared,
            bot_user_id=listener.bot_user_id,
            key=f"agui-tool:{run_id}:{call_id}",
            post=post,
        )
    results = [agui_tools.tool_message(call_id, outcome, speaks_1_0=sent_1_0)]
    for later in resumed.later:
        results.append(
            agui_tools.tool_message(
                str(later.get("id") or ""),
                agui_tools.not_run("it waited behind a post the person was asked about"),
                speaks_1_0=sent_1_0,
            )
        )
    return [*resumed.exchange, *results], resumed.round + 1
