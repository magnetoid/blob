"""Running an AG-UI agent when somebody mentions it.

A person @-mentions an app's bot in a channel that bot has joined. This POSTs the
surrounding conversation to the app's AG-UI endpoint as a standard `RunAgentInput`,
reads the event stream back, and writes whatever the agent said as ordinary messages
from that bot, in the place it was addressed.

It never raises, apart from letting its own cancellation through. A retry would re-run
the agent — new tokens, new latency, possibly a different answer — so every failure is
caught, recorded on the run, and shown to the person who asked, and the job is registered
with one try. A run cancelled under it (a restart, arq's ceiling) closes its own row on
the way out. The same reasoning as `plugins/delivery.py`: an app that misbehaves degrades
itself and nothing else.

No transaction is ever open across the HTTP call. The session that reads the history is
closed before the agent is contacted, and each message the agent produces commits on its
own, so a failure on the third answer cannot roll back the first two.

This module is the dispatcher: claim the message, decide whose authority the run is on
and which agents it reached, and run each of them. `agui_admission.py` holds the
deciding, `agui_outcome.py` one agent's run from start to what it left behind, and
`agui_stream.py` the live card and the Stop button.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from functools import partial
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib import queue as queue_lib
from ..lib.redis import redis
from ..plugins import agui, decisions
from ..plugins.streams import Listener, stream_run
from ..realtime import hub
from ..services import agent_access, agent_chains, agent_follows, task_dispatch
from ..services import agent_runs as agent_run_service
from ..services import messages as message_service
from ..services import policies as policy_service
from ..services.serialize import message_event
from ..services.workspace_settings import parse as parse_settings
from . import agui_delegate, agui_later
from .agui_admission import (
    followers_for,
    listeners_for,
    may_follow_now,
    personal_agent_for,
    unanswered_follower,
)
from .agui_outcome import refuse, run_one

log = logging.getLogger("blob.jobs.agui")


async def _claim(message_id: str) -> bool:
    """Best-effort lease so a duplicate enqueue does not even read the trigger twice.

    The run row is what actually prevents a second run: `agent_runs.start` writes at most
    one per trigger, agent and parent, and refuses the rest. This only saves the reads
    before that, so failing open is correct: if Redis is unavailable the job still runs
    and still cannot run the same agent twice.
    """
    try:
        claimed = await redis.set(f"agui:run:{message_id}", "1", nx=True, ex=300)
        return bool(claimed)
    except Exception:
        log.warning("could not take the agui run lease", exc_info=True)
        return True


async def _trigger(session: Any, message_id: str) -> Any:
    """The message a run answers: what deciding who answers it, and on whose authority,
    reads of it."""
    return (
        await session.execute(
            text(
                """
                SELECT id, workspace_id, channel_id, author_id, kind, plugin_id,
                       client_msg_id, thread_root_id, mention_user_ids, deleted_at
                  FROM messages WHERE id = :id
                """
            ),
            {"id": message_id},
        )
    ).first()


async def handle_agui_run(message_id: str, parent_run_id: str | None = None) -> None:
    try:
        await _run(message_id, parent_run_id)
    except Exception:
        # Nothing above this catches. The job is registered with one try, so arq would
        # not re-run the agent either way; this keeps the failure in our log.
        log.warning("agui run failed for %s", message_id, exc_info=True)


async def expire_agent_decisions() -> int:
    """Decisions nobody made in time: mark the runs, take the buttons off their cards, and
    block the task a run was handed, if it was handed one (ADR 0023)."""
    async with transaction() as (session, after):
        expired = await agent_run_service.expire_waiting(session)
        for row in expired:
            channel_id = row["channel_id"]
            await task_dispatch.settle(
                session,
                after,
                chain_id=row["chain_id"],
                plugin_id=row["plugin_id"],
                status="expired",
            )
            if row["decision_message_id"]:
                stored = row["interrupt"] if isinstance(row["interrupt"], dict) else {}
                decision = agui.decision_of(stored.get("items"))
                settled = await message_service.replace_blocks(
                    session, row["decision_message_id"], decisions.expired_blocks(decision)
                )
                if settled is not None:
                    after.add(
                        partial(
                            hub.to_channel, channel_id, message_event("message.updated", settled)
                        )
                    )
            after.add(
                partial(
                    hub.to_channel,
                    channel_id,
                    {
                        "t": "agent_run.finished",
                        "runId": row["id"],
                        "channelId": channel_id,
                        "status": "expired",
                        "error": None,
                        "postCount": 0,
                    },
                )
            )
    return len(expired)


async def _run(message_id: str, parent_run_id: str | None = None) -> None:
    if not await _claim(message_id):
        return

    async with session_scope() as session:
        trigger = await _trigger(session, message_id)
        if not trigger or trigger.deleted_at or trigger.kind == "system":
            return

        # Who is asking, and on whose authority. A person's message roots a chain; an
        # agent's reply may extend one by a hop, on the person's authority; a person's
        # answer to a decision resumes the run that asked. Anything else — above all a
        # bot's message with no parent run, which is how the bot API posts — starts
        # nothing: there is no person behind it to run on the authority of. ADR 0013.
        chain: agent_chains.Chain | None
        resume_bot: str | None = None
        if trigger.kind == "user" and parent_run_id is None:
            chain = agent_chains.root(trigger)
        elif trigger.kind == "user" and parent_run_id is not None:
            resumed = await agent_chains.resume_of(
                session, parent_run_id=parent_run_id, trigger=trigger
            )
            if resumed is None:
                return
            chain, resume_bot = resumed
        elif trigger.kind == "bot" and parent_run_id is not None:
            chain = await agent_chains.child_of(
                session, parent_run_id=parent_run_id, trigger=trigger
            )
            if chain is None:
                return
        else:
            return

        # A resume runs the one agent that asked, whatever else the answer mentions.
        mentioned = [resume_bot] if resume_bot else list(trigger.mention_user_ids or [])
        listeners = (
            await listeners_for(
                session, workspace_id=trigger.workspace_id, mention_user_ids=mentioned
            )
            if mentioned
            else []
        )

        # A DM with an agent the room may address — a resident one, or the person's own —
        # is addressed by the room rather than by a mention: there is nobody else in it,
        # so making people type `@Janus` at a wall would be ceremony. Slack's own
        # assistant works this way and so does every DM anyone has ever sent, which is
        # the point — this is the Slack reflex, not a new one. `personal_agent_for` holds
        # the exact rule, and which agents qualify is its business rather than this one's.
        #
        # Only for a person's own message. An agent's reply in a two-member room is never
        # a trigger here, which is what keeps two agents from talking to each other for
        # ever in a DM that happens to hold them both.
        if chain.is_root:
            personal = await personal_agent_for(
                session, workspace_id=trigger.workspace_id, channel_id=trigger.channel_id
            )
            if personal and all(known.plugin_id != personal.plugin_id for known in listeners):
                # Deduped because mentioning it *inside* its own DM is a thing people do
                # out of habit, and it must not answer twice for one message.
                listeners = [*listeners, personal]

            # An agent following this channel hears a person's message it was not
            # addressed in (ADR 0026). Only on a person's own message — `is_root` — and
            # never twice: an agent the message mentioned, or whose DM this is, answers as
            # itself, addressed. Following is set on channels only, never on a
            # conversation between people (`agent_follows.follow`).
            followers = await followers_for(
                session,
                workspace_id=trigger.workspace_id,
                channel_id=trigger.channel_id,
                message_id=str(trigger.id),
            )
            listeners = [
                *listeners,
                *(
                    follower
                    for follower in followers
                    if all(known.plugin_id != follower.plugin_id for known in listeners)
                ),
            ]

        if not listeners:
            return

        going = await _admit(session, trigger, chain, listeners)
    if going is None:
        return
    await _set_going(trigger, chain, going, thread_root_id=trigger.thread_root_id)


@dataclass(slots=True)
class _Going:
    """Who answers a trigger, and what their runs need to know — decided under one session
    by `_admit`, then set going by `_set_going` once it is closed."""

    listeners: list[Listener]
    max_depth: int
    asker: str
    on_behalf_of: str | None
    channel_name: str | None
    agents_enabled: bool


async def _admit(
    session: Any, trigger: Any, chain: agent_chains.Chain, listeners: list[Listener]
) -> _Going | None:
    """Of the agents a trigger reached, those that may answer it now — or None when none
    may. Whose agent each is, a follow's throttle, the chain's budget at a hop, and the
    names and switches the runs need. Shared by a posted message and a question handed on
    late (`_hear_late`), so both meet the same rules."""
    # Whose agent is it? An agent with no owner is the workspace's and answers anyone;
    # an owned one answers its owner and whoever they have lent it to. Asked of the
    # person the chain runs on — at a hop that is the person at the root, not the
    # agent whose reply did the mentioning, so an agent everyone can talk to does not
    # become a way to command one only its owner may.
    #
    # A refusal is silence, deliberately. Telling the room "that is not your agent"
    # would make an owned agent's existence, and its owner, discoverable by anyone who
    # guessed a name — and the mention itself is already visible to everybody, so the
    # person who tried can see perfectly well that nothing happened.
    allowed_bots = await agent_access.commandable_by(
        session,
        workspace_id=trigger.workspace_id,
        actor_id=chain.initiated_by_user_id,
        channel_id=trigger.channel_id,
        bot_user_ids=[known.bot_user_id for known in listeners],
    )
    for known in [k for k in listeners if k.bot_user_id not in allowed_bots]:
        log.info(
            "agui: %s may not command agent %s in %s",
            chain.initiated_by_user_id,
            known.plugin_id,
            trigger.channel_id,
        )
    listeners = [known for known in listeners if known.bot_user_id in allowed_bots]

    # A follow is never worth a word in the room when it cannot go: over the agent's
    # budget, or inside its quiet period in this channel, or past the day's cap, it is
    # dropped here in silence — a refusal card under every message of a busy channel
    # would be the noise following must never make. A mention keeps its refusals.
    heard: list[Listener] = []
    for known in listeners:
        if not known.addressed:
            if await agent_run_service.check_budget(session, plugin_id=known.plugin_id):
                continue
            if not await may_follow_now(known.plugin_id, trigger.channel_id):
                continue
        heard.append(known)
    listeners = heard
    if not listeners:
        return None

    policy = await policy_service.effective_for(session, trigger.workspace_id)
    max_depth = policy.agent_chain_max_depth
    # Whether their addresses may be private is the workspace's, read once here (`egress`).
    listeners = [replace(known, private_ok=policy.may_use_private_endpoints) for known in listeners]
    # A hop spends the chain's budget; a resume does not. It is the person answering
    # the agent that asked, so it adds no hop — and the budget's rules would refuse
    # it: `admit` drops the agent whose reply caused a hop ("mentioned itself"), which
    # for a resume is the one agent being resumed, and a person may take far longer
    # than the chain's quarter hour to answer a question that waits a day. So a
    # decision raised anywhere past the root could never be answered at all.
    if chain.depth > 0 and not chain.resuming:
        admitted = await agent_chains.admit(
            session,
            chain,
            candidates=[(known.plugin_id, known.bot_user_id) for known in listeners],
            max_depth=max_depth,
        )
        listeners = [known for known in listeners if known.bot_user_id in admitted]
        if not listeners:
            return None

    rows = (
        await session.execute(
            text("SELECT id, display_name FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
            {"ids": [trigger.author_id, chain.initiated_by_user_id]},
        )
    ).fetchall()
    display = {str(row.id): row.display_name for row in rows}
    asker = display.get(str(trigger.author_id)) or "someone"
    on_behalf_of = display.get(chain.initiated_by_user_id) if chain.depth > 0 else None
    channel_name = (
        await session.execute(
            text("SELECT name FROM channels WHERE id = :id"), {"id": trigger.channel_id}
        )
    ).scalar_one_or_none()

    settings_row = (
        await session.execute(
            text("SELECT settings FROM workspace_settings WHERE workspace_id = :ws"),
            {"ws": trigger.workspace_id},
        )
    ).fetchone()
    agents_enabled = parse_settings(settings_row.settings if settings_row else None).agents_enabled
    return _Going(
        listeners=listeners,
        max_depth=max_depth,
        asker=asker,
        on_behalf_of=on_behalf_of,
        channel_name=channel_name,
        agents_enabled=agents_enabled,
    )


async def _set_going(
    trigger: Any, chain: agent_chains.Chain, going: _Going, *, thread_root_id: str | None
) -> None:
    """Refuse every addressed agent when agents are off, or run them all at once."""
    listeners = going.listeners
    asker, channel_name = going.asker, going.channel_name
    max_depth, on_behalf_of = going.max_depth, going.on_behalf_of
    if not going.agents_enabled:
        # The kill switch is workspace-wide: every mentioned agent is refused, none is
        # called, and the run log is how "I mentioned it and nothing happened" is answered.
        # A follow is simply not heard: nobody asked, so there is nobody to answer.
        async with transaction() as (session, after):
            for known in (known for known in listeners if known.addressed):
                await refuse(
                    session,
                    after,
                    known,
                    workspace_id=trigger.workspace_id,
                    channel_id=trigger.channel_id,
                    thread_root_id=thread_root_id,
                    trigger_id=trigger.id,
                    trigger_user_id=trigger.author_id,
                    reason="Agents are turned off for this server.",
                    chain_id=chain.chain_id,
                )
        return

    # Concurrent, not sequential: with a 120-second ceiling per run, a message that
    # mentions three agents used to answer in worst-case six minutes, and one hung
    # agent delayed every other agent's reply to the same message. `run_one` closes its
    # own run on any failure after the row is written; what it raises before that is
    # logged here rather than discarded, which is what `return_exceptions` alone did.
    outcomes = await asyncio.gather(
        *(
            run_one(
                listener,
                workspace_id=trigger.workspace_id,
                channel_id=trigger.channel_id,
                thread_root_id=thread_root_id,
                trigger_id=trigger.id,
                trigger_user_id=trigger.author_id,
                asker=asker,
                channel_name=channel_name or "a conversation",
                chain=chain,
                max_depth=max_depth,
                on_behalf_of=on_behalf_of,
            )
            for listener in listeners
        ),
        return_exceptions=True,
    )
    for listener, outcome in zip(listeners, outcomes, strict=True):
        if isinstance(outcome, asyncio.CancelledError):
            raise outcome
        if isinstance(outcome, BaseException):
            log.error(
                "agui: the run for %s on %s failed",
                listener.plugin_id,
                trigger.id,
                exc_info=outcome,
            )


async def hear_unanswered_questions() -> int:
    """Hand each question that went unanswered in a channel an agent follows for those to
    that agent (ADR 0026's addendum): one job per question and agent. Answers how many.

    No lease: a pair handed on twice before its run row exists runs once anyway — the row
    is the ledger (`agent_runs.start`) — and a pair the follow throttle turned away has no
    row, so the next sweep tries it again while it is still in its window."""
    async with session_scope() as session:
        due = await agent_follows.unanswered_questions(session, now=datetime.now(UTC))
    for message_id, plugin_id in due:
        await queue_lib.enqueue("agui_follow_late", message_id, plugin_id)
    return len(due)


async def handle_follow_late(message_id: str, plugin_id: str) -> None:
    """A question nobody answered, for the agent following its channel for those. Never
    raises, like a run."""
    try:
        await _hear_late(message_id, plugin_id)
    except Exception:
        log.warning("could not hand %s to agent %s", message_id, plugin_id, exc_info=True)


async def _hear_late(message_id: str, plugin_id: str) -> None:
    async with session_scope() as session:
        trigger = await _trigger(session, message_id)
        if (
            trigger is None
            or trigger.deleted_at
            or trigger.kind != "user"
            or trigger.thread_root_id is not None
        ):
            return
        # Somebody may have answered between the sweep and now.
        if not await agent_follows.still_unanswered(session, message_id=message_id):
            return
        follower = await unanswered_follower(
            session,
            workspace_id=str(trigger.workspace_id),
            channel_id=str(trigger.channel_id),
            plugin_id=plugin_id,
        )
        if follower is None:
            return
        # The asker's message roots the chain, as it would have had it been heard as it
        # was posted (ADR 0013): the person behind the run is the one who asked.
        chain = agent_chains.root(trigger)
        going = await _admit(session, trigger, chain, [follower])
    if going is None:
        return
    # In the question's own thread: a reply to it is what answering it is.
    await _set_going(trigger, chain, going, thread_root_id=str(trigger.id))


async def handle_agent_heard(run_id: str) -> None:
    """Carry on a run that waited on another agent's answer (M2 · A2) — once that agent
    has stopped, or the wait has run out. Enqueued by the other agent's finish, and by the
    cron below for what that misses. Never raises, like a run."""
    try:
        await _hear(run_id)
    except Exception:
        log.warning("could not carry on run %s after its question", run_id, exc_info=True)


async def resume_waiting_runs() -> int:
    """The net under the hop's own call: a waiting run whose hop finished a moment before
    it began to wait, whose hop never started, or that has waited past the chain's wall.
    Answers how many it handed on.

    Each goes to an `agent_heard` job of its own rather than being carried on here: a
    continuation is an agent run, up to ten minutes long, and this cron runs under the
    worker's five-minute ceiling — one long answer would have been cut off mid-run.
    `_hear` decides whether there is anything to tell yet, under its row lock, so a run
    handed on twice is carried on once."""
    async with session_scope() as session:
        due = await agent_run_service.waiting_to_hear(
            session,
            limit_sec=agui_delegate.WAIT_LIMIT_SEC,
            grace_sec=agui_delegate.NO_RUN_GRACE_SEC,
        )
    for run_id in due:
        await queue_lib.enqueue("agent_heard", run_id)
    return len(due)


async def _hear(run_id: str) -> None:
    async with transaction() as (session, after):
        # Locked and skipped, so the hop's call and the cron cannot both carry it on: the
        # one that takes the row flips it, and the other finds nothing waiting.
        row = (
            await session.execute(
                text(
                    """
                    SELECT r.id, r.workspace_id, r.plugin_id, r.channel_id, r.thread_root_id,
                           r.trigger_message_id, r.trigger_user_id, r.chain_id, r.depth,
                           r.initiated_by_user_id, r.interrupt, r.state, r.finished_at,
                           u.id AS bot_user_id
                      FROM agent_runs r
                      JOIN users u ON u.bot_plugin_id = r.plugin_id
                     WHERE r.id = :id AND r.status = 'waiting'
                       FOR UPDATE OF r SKIP LOCKED
                    """
                ),
                {"id": run_id},
            )
        ).first()
        if row is None:
            return
        stored: dict[str, Any] = row.interrupt if isinstance(row.interrupt, dict) else {}
        # Waiting for a time it said it would come back at (ADR 0040), or on another agent.
        coming_back = stored.get("kind") == agui_later.KIND
        outcome = agui_later.woken(stored) if coming_back else None
        if coming_back and outcome is None:
            return
        if row.initiated_by_user_id is None or row.trigger_message_id is None:
            # The person or the message it answered is gone (both SET NULL): nothing is
            # left to carry on for, and a run left waiting would be picked up by the cron
            # every minute for ever.
            await _end_waiting(
                session, after, row, "the message it was answering, or its person, is gone"
            )
            return
        if coming_back:
            refusal = await agui_later.no_longer(session, row)
            if refusal is not None:
                await _end_waiting(session, after, row, f"it did not come back: {refusal}")
                return
        else:
            outcome = await agui_delegate.heard(session, row)
        if outcome is None:
            return
        listeners = await listeners_for(
            session, workspace_id=str(row.workspace_id), mention_user_ids=[str(row.bot_user_id)]
        )
        if not listeners:
            # Uninstalled or switched off while it waited: nobody is left to carry it on, so
            # it ends as failed — and a task it was handed is told — rather than standing as
            # an answer that never came.
            await _end_waiting(
                session, after, row, "it was switched off or removed while it waited"
            )
            return
        # It asked, and it was answered: the run that asked is done, and its continuation
        # is a run of its own. `answered_at` is what tells a waiter on *this* run that it
        # has been carried on and the answer is still to come.
        await session.execute(
            text("UPDATE agent_runs SET status = 'succeeded', answered_at = now() WHERE id = :id"),
            {"id": run_id},
        )
        view = await agent_run_service.view_of(session, run_id)
        if view is not None:
            room = str(row.channel_id)
            after.add(partial(hub.to_channel, room, {"t": "agent_run.started", "run": view}))

        chain = agent_chains.Chain(
            chain_id=str(row.chain_id),
            initiated_by_user_id=str(row.initiated_by_user_id),
            depth=int(row.depth),
            parent_run_id=str(row.id),
            parent_plugin_id=str(row.plugin_id),
            state=row.state,
            exchange_after=str(row.trigger_message_id),
            agent_answer=agent_chains.AgentAnswer(
                call=_mapping(stored.get("call")),
                text=outcome.content,
                error=outcome.error,
                later=_mappings(stored.get("later")),
                exchange=_mappings(stored.get("exchange")),
                round=int(stored.get("round") or 0),
                behind="a follow-up" if coming_back else "a question to another agent",
            ),
        )
        names = {
            str(found.id): found.display_name
            for found in (
                await session.execute(
                    text("SELECT id, display_name FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
                    {"ids": [row.trigger_user_id, row.initiated_by_user_id]},
                )
            ).fetchall()
        }
        channel_name = (
            await session.execute(
                text("SELECT name FROM channels WHERE id = :id"), {"id": row.channel_id}
            )
        ).scalar_one_or_none()
        policy = await policy_service.effective_for(session, str(row.workspace_id))
    await run_one(
        replace(listeners[0], private_ok=policy.may_use_private_endpoints),
        workspace_id=str(row.workspace_id),
        channel_id=str(row.channel_id),
        thread_root_id=str(row.thread_root_id) if row.thread_root_id else None,
        trigger_id=str(row.trigger_message_id),
        trigger_user_id=str(row.trigger_user_id) if row.trigger_user_id else None,
        asker=names.get(str(row.trigger_user_id)) or "someone",
        channel_name=channel_name or "a conversation",
        chain=chain,
        max_depth=policy.agent_chain_max_depth,
        on_behalf_of=names.get(str(row.initiated_by_user_id)) if row.depth > 0 else None,
    )


async def _end_waiting(session: Any, after: Any, row: Any, reason: str) -> None:
    """End a waiting run that cannot be carried on — as failed, with why on its card — and
    tell a task it was handed, rather than leave it standing as an answer that never came."""
    run_id = str(row.id)
    await session.execute(
        text(
            "UPDATE agent_runs SET status = 'failed', error = :error, answered_at = now()"
            " WHERE id = :id"
        ),
        {"id": run_id, "error": reason},
    )
    await task_dispatch.settle(
        session,
        after,
        chain_id=str(row.chain_id),
        plugin_id=str(row.plugin_id),
        status="failed",
        reason=reason,
    )
    view = await agent_run_service.view_of(session, run_id)
    if view is not None:
        room = str(row.channel_id)
        after.add(partial(hub.to_channel, room, {"t": "agent_run.started", "run": view}))


def _mapping(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _mappings(value: object) -> list[dict[str, Any]]:
    return (
        [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []
    )


__all__ = [
    "Listener",
    "expire_agent_decisions",
    "handle_agent_heard",
    "handle_agui_run",
    "listeners_for",
    "resume_waiting_runs",
    "stream_run",
]
