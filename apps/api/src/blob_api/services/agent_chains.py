"""A chain: what lets agents answer each other, and what stops them going on for ever.

Only a person's message used to start a run. That was the loop guard, and it was
structural — two agents that mentioned each other could not converse because neither's
messages was a trigger. It also meant they could not hand each other anything at all.

The replacement is a *chain*. A person's message roots one. An agent's reply that mentions
another agent may extend it by one hop, and a person's answer to a decision an agent was
waiting on resumes the run that asked. Three rules keep that from being the runaway case:

- **A hop runs on the person's authority, never the agent's.** Whether the mentioned agent
  may be commanded is asked of the person at the root (`agent_access.commandable_by` with
  their id), so an agent everybody can talk to does not become a way to command an agent
  only its owner may. Refusal is silence, as it is for a person.
- **A chain has a depth budget** — `workspace_policies.agent_chain_max_depth`, with the
  environment as the ceiling — and a few caps behind it: runs per chain, runs per agent
  per chain (the ping-pong guard: A→B→A→B stops whatever the depth allows), and a wall
  clock from the root. Every refusal here is logged and nothing else: a refusal card under
  a bot's message would be noise nobody asked for.
- **A bot's message with no parent run starts nothing.** That is how the bot API posts,
  and it must stay inert — there is no person behind it to run on the authority of.

This module is the rules; `jobs/agui.py` applies them. ADR 0013.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import AppError, forbidden, not_found
from ..lib.ids import new_id
from ..lib.queue import enqueue, fire_and_forget
from ..plugins import agui, decisions
from . import agent_runs as agent_run_service
from . import channels as channel_service
from . import messages as message_service

log = logging.getLogger("blob.services.agent_chains")

#: Runs one chain may hold, however deep the policy lets it go.
MAX_RUNS_PER_CHAIN = 12
#: Runs one agent may have in one chain. A→B→A→B ends here whatever the depth budget.
MAX_RUNS_PER_AGENT_PER_CHAIN = 3
#: Wall clock from the chain's first run. A conversation between agents that is still
#: going a quarter of an hour later is not converging.
CHAIN_MAX_SEC = 900
#: How long a decision waits for the person who asked before it expires.
INTERRUPT_TTL_SEC = 24 * 3600


@dataclass(slots=True)
class Chain:
    """Where a run sits, and on whose authority it runs."""

    #: The person's message that rooted the chain.
    chain_id: str
    #: Whose authority every hop runs on — the person at the root.
    initiated_by_user_id: str
    #: Hops from the person. 0 at the root; a resume keeps its parent's depth.
    depth: int
    parent_run_id: str | None = None
    parent_plugin_id: str | None = None
    #: The agent whose reply mentioned this one. None at the root and on a resume.
    asked_by: str | None = None
    #: Set on a resume: what the answering run is told about the question it answers.
    resume: list[dict[str, Any]] | None = None
    state: Any = None
    parent_agui_run_id: str | None = None

    @property
    def is_root(self) -> bool:
        return self.parent_run_id is None


def root(trigger: Any) -> Chain:
    """A person's own message: the start of a chain, with themselves as its authority."""
    return Chain(chain_id=str(trigger.id), initiated_by_user_id=str(trigger.author_id), depth=0)


async def child_of(session: AsyncSession, *, parent_run_id: str, trigger: Any) -> Chain | None:
    """The hop an agent's reply starts, or None if there is no chain for it to extend.

    The parent has to be the run that actually posted the reply — same channel, same
    agent — and not one somebody has stopped: Stop cascades to children, and a child that
    was enqueued in the gap must not slip past it.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT r.id, r.chain_id, r.depth, r.initiated_by_user_id, r.plugin_id,
                       r.workspace_id, r.channel_id, r.status, r.cancel_requested_at,
                       p.name AS agent_name
                  FROM agent_runs r
                  JOIN plugins p ON p.id = r.plugin_id
                 WHERE r.id = :id
                """
            ),
            {"id": parent_run_id},
        )
    ).fetchone()
    if row is None:
        return None
    if str(row.workspace_id) != str(trigger.workspace_id) or str(row.channel_id) != str(
        trigger.channel_id
    ):
        return None
    if trigger.plugin_id is None or str(row.plugin_id) != str(trigger.plugin_id):
        return None
    if row.cancel_requested_at is not None or row.status == "cancelled":
        log.info("agent chain %s: parent %s was stopped; no hop", row.chain_id, row.id)
        return None
    if row.initiated_by_user_id is None:
        # The person who rooted this is gone. Nobody's authority to run on.
        return None
    return Chain(
        chain_id=str(row.chain_id),
        initiated_by_user_id=str(row.initiated_by_user_id),
        depth=int(row.depth) + 1,
        parent_run_id=str(row.id),
        parent_plugin_id=str(row.plugin_id),
        asked_by=row.agent_name,
    )


async def resume_of(
    session: AsyncSession, *, parent_run_id: str, trigger: Any
) -> tuple[Chain, str] | None:
    """The run a person's answer resumes, and the bot user to run it as.

    A resume is the person speaking, so it keeps the parent's depth rather than adding a
    hop, and it runs exactly one agent — the one that asked — whatever else the answer
    happens to mention.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT r.id, r.chain_id, r.depth, r.initiated_by_user_id, r.plugin_id,
                       r.channel_id, r.status, r.answered_at, r.interrupt, r.state,
                       r.trigger_message_id, u.id AS bot_user_id
                  FROM agent_runs r
                  JOIN users u ON u.bot_plugin_id = r.plugin_id
                 WHERE r.id = :id AND r.workspace_id = :ws
                """
            ),
            {"id": parent_run_id, "ws": trigger.workspace_id},
        )
    ).fetchone()
    if row is None or row.status != "interrupted" or row.answered_at is None:
        return None
    if str(row.channel_id) != str(trigger.channel_id):
        return None
    if str(row.initiated_by_user_id) != str(trigger.author_id):
        return None
    if not str(trigger.client_msg_id or "").startswith(f"agent-answer:{parent_run_id}:"):
        return None

    stored = row.interrupt if isinstance(row.interrupt, dict) else {}
    raw_items = stored.get("items")
    items: list[Any] = raw_items if isinstance(raw_items, list) else []
    answer = stored.get("answer")
    ids = [
        item["id"] for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    resume = [
        {"interruptId": i, "status": "resolved", "payload": answer} for i in ids or ["default"]
    ]
    return (
        Chain(
            chain_id=str(row.chain_id),
            initiated_by_user_id=str(row.initiated_by_user_id),
            depth=int(row.depth),
            parent_run_id=str(row.id),
            parent_plugin_id=str(row.plugin_id),
            resume=resume,
            state=row.state,
            parent_agui_run_id=str(row.trigger_message_id) if row.trigger_message_id else None,
        ),
        str(row.bot_user_id),
    )


def can_spawn(chain: Chain, max_depth: int) -> bool:
    """Whether a reply from this run may carry the chain one hop further."""
    return chain.depth < max_depth


async def admit(
    session: AsyncSession,
    chain: Chain,
    *,
    candidates: list[tuple[str, str]],
    max_depth: int,
) -> set[str]:
    """Which of these (plugin_id, bot_user_id) pairs a hop may run. Budgets only.

    Ownership was already asked, of the person at the root, before this is called. What
    remains is whether the chain itself has room: depth, total runs, wall clock, and the
    per-agent cap that ends two agents bouncing a question between them. Admitting
    several at once can overshoot a cap by the fan-out width, like the daily budget — a
    dam, not a turnstile.
    """
    if chain.depth > max_depth:
        log.info(
            "agent chain %s: depth %d over the budget of %d", chain.chain_id, chain.depth, max_depth
        )
        return set()
    totals = (
        await session.execute(
            text(
                """
                SELECT count(*) AS runs,
                       EXTRACT(EPOCH FROM (now() - min(started_at))) AS age
                  FROM agent_runs WHERE chain_id = :chain
                """
            ),
            {"chain": chain.chain_id},
        )
    ).fetchone()
    runs = int(totals.runs) if totals else 0
    age = float(totals.age) if totals and totals.age is not None else 0.0
    if runs >= MAX_RUNS_PER_CHAIN:
        log.info("agent chain %s: %d runs already; no more", chain.chain_id, runs)
        return set()
    if age > CHAIN_MAX_SEC:
        log.info("agent chain %s: %.0fs old; no more", chain.chain_id, age)
        return set()

    plugin_ids = [plugin_id for plugin_id, _ in candidates]
    per_agent = {
        str(row.plugin_id): int(row.n)
        for row in (
            await session.execute(
                text(
                    """
                    SELECT plugin_id, count(*) AS n FROM agent_runs
                     WHERE chain_id = :chain AND plugin_id = ANY(cast(:ids AS uuid[]))
                     GROUP BY plugin_id
                    """
                ),
                {"chain": chain.chain_id, "ids": plugin_ids},
            )
        ).fetchall()
    }

    allowed: set[str] = set()
    for plugin_id, bot_user_id in candidates:
        if plugin_id == chain.parent_plugin_id:
            log.info("agent chain %s: %s mentioned itself; ignored", chain.chain_id, plugin_id)
            continue
        if per_agent.get(plugin_id, 0) >= MAX_RUNS_PER_AGENT_PER_CHAIN:
            log.info(
                "agent chain %s: %s has run %d times here; no more",
                chain.chain_id,
                plugin_id,
                per_agent[plugin_id],
            )
            continue
        allowed.add(bot_user_id)
    return allowed


# ─── answering a decision ─────────────────────────────────────────────────────


@dataclass(slots=True)
class Answered:
    run_id: str
    channel_id: str
    answer_message_id: str


async def answer(
    session: AsyncSession,
    after: Any,
    *,
    workspace_id: str,
    run_id: str,
    user_id: str,
    user_name: str,
    action_id: str | None,
    value: str,
    client_action_id: str | None,
) -> Answered:
    """The person who asked answers; the run that asked resumes.

    Everything happens in the caller's transaction and drains past COMMIT through
    `after`: the answer is posted as the person's own message (so the channel sees the
    decision as a decision, not as a button press), the card is settled, the run is
    re-announced with `answeredAt`, and the resume is enqueued — with this run as its
    parent, so the job knows to resume rather than root.

    Only the person the chain runs on may answer. The card is visible to the whole
    channel, so its existence is not the private thing; who may decide is.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT id, status, answered_at, expires_at, initiated_by_user_id,
                       channel_id, thread_root_id, interrupt, decision_message_id
                  FROM agent_runs
                 WHERE id = :id AND workspace_id = :ws
                 FOR UPDATE
                """
            ),
            {"id": run_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None or row.status not in ("interrupted", "expired"):
        raise not_found("That run is not waiting on a decision.")
    channel_id = str(row.channel_id)
    stored = row.interrupt if isinstance(row.interrupt, dict) else {}

    if row.answered_at is not None or row.status == "expired":
        if client_action_id and stored.get("answer_client_id") == client_action_id:
            # The same click again — a retry, not a second decision.
            return Answered(run_id=run_id, channel_id=channel_id, answer_message_id="")
        raise AppError(
            409,
            "run_not_waiting",
            "That decision expired."
            if row.status == "expired"
            else "That decision was already made.",
        )
    if row.expires_at is not None:
        due = (
            await session.execute(
                text("SELECT cast(:at AS timestamptz) < now() AS past"), {"at": row.expires_at}
            )
        ).scalar_one()
        if due:
            # Left for the expiry sweep to mark: raising here rolls this transaction back,
            # and the sweep runs within the quarter hour anyway.
            raise AppError(409, "run_not_waiting", "That decision expired.")
    if str(row.initiated_by_user_id) != user_id:
        raise forbidden("Only the person who asked can answer this.")
    await channel_service.assert_channel_access(
        session, user_id, channel_id, require_member=True, require_writable=True
    )

    raw_items = stored.get("items")
    items: list[Any] = raw_items if isinstance(raw_items, list) else []
    decision = agui.decision_of(items)
    label, payload = decisions.payload_for(decision, action_id, value)

    result = await message_service.send(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=user_id,
        body=label,
        client_msg_id=f"agent-answer:{run_id}:{client_action_id or new_id()}",
        thread_root_id=str(row.thread_root_id) if row.thread_root_id else None,
        kind="user",
    )
    # The answer is a message like any other — broadcast, notified, unfurled — except that
    # it does not root a chain of its own: it *resumes* the run that asked, below.
    await message_service.announce(
        session,
        after,
        result,
        workspace_id=workspace_id,
        channel_id=channel_id,
        start_agent_runs=False,
    )
    answer_id = result.message.id

    await session.execute(
        text(
            """
            UPDATE agent_runs
               SET answered_at = now(),
                   interrupt = COALESCE(interrupt, '{}'::jsonb)
                               || jsonb_build_object('answer', cast(:answer AS jsonb),
                                                     'answer_client_id', cast(:cid AS text))
             WHERE id = :id
            """
        ),
        {"id": run_id, "answer": json.dumps(payload), "cid": client_action_id},
    )

    from ..realtime import hub
    from .serialize import message_event

    if row.decision_message_id:
        settled = await message_service.replace_blocks(
            session,
            str(row.decision_message_id),
            decisions.settled_blocks(decision, answered_by=user_name, answer=label),
        )
        if settled is not None:
            event = message_event("message.updated", settled)
            after.add(lambda: hub.to_channel(channel_id, event))

    view = await agent_run_service.view_of(session, run_id)
    if view is not None:
        # `agent_run.started` is an upsert on the client; this is how `answeredAt` lands.
        after.add(lambda: hub.to_channel(channel_id, {"t": "agent_run.started", "run": view}))
    after.add(lambda: fire_and_forget(enqueue("agui_run", answer_id, run_id)))
    return Answered(run_id=run_id, channel_id=channel_id, answer_message_id=answer_id)


__all__ = [
    "CHAIN_MAX_SEC",
    "INTERRUPT_TTL_SEC",
    "MAX_RUNS_PER_AGENT_PER_CHAIN",
    "MAX_RUNS_PER_CHAIN",
    "Answered",
    "Chain",
    "admit",
    "answer",
    "can_spawn",
    "child_of",
    "resume_of",
    "root",
]
