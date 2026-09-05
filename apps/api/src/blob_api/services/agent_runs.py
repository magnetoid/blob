"""What happened when an agent was asked something.

Before this, a run left no trace but `plugins.last_error`, which the next failure
overwrote. So the question people actually ask — "I mentioned the agent and nothing
happened, why?" — had no answer: a run that failed, a run that finished cleanly and said
nothing, and a run that never started all looked identical from outside.

Written in two short transactions around the network call rather than one held across it,
because holding a Postgres transaction open while somebody else's server thinks is how a
slow agent becomes a database problem — the same reasoning `services/commands` gives for
dispatching an app command with no transaction open.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id
from ..schemas.base import require_iso

RunStatus = Literal[
    "running", "succeeded", "failed", "interrupted", "cancelled", "refused", "expired"
]


@dataclass(slots=True)
class Run:
    id: str
    plugin_id: str
    channel_id: str
    channel_name: str | None
    thread_root_id: str | None
    trigger_message_id: str | None
    trigger_user_name: str | None
    transport: str
    status: str
    error: str | None
    post_count: int
    started_at: Any
    finished_at: Any
    #: Hops from the person who rooted the chain; 0 when they mentioned it themselves.
    depth: int = 0
    #: The agent whose reply asked this one, when depth > 0.
    asked_by: str | None = None


async def start(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_message_id: str,
    trigger_user_id: str | None,
    transport: str,
    chain_id: str,
    initiated_by_user_id: str | None,
    parent_run_id: str | None = None,
    depth: int = 0,
) -> str:
    """Record that a run began, before the agent is called.

    Written first on purpose: a run that never returns — a process killed mid-call, an
    agent that hangs past every timeout — is exactly the case with nothing to show for
    it, and it is the one that leaves a `running` row behind to say so.

    The lineage columns are what make a chain a chain (ADR 0013): every run knows the
    person's message that rooted it, the run whose reply caused it, how many hops it is
    from the person, and whose authority it runs on.
    """
    run_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO agent_runs
              (id, workspace_id, plugin_id, channel_id, thread_root_id,
               trigger_message_id, trigger_user_id, transport, status,
               chain_id, parent_run_id, depth, initiated_by_user_id)
            VALUES
              (:id, :ws, :plugin_id, :channel_id, cast(:thread_root_id AS uuid),
               cast(:trigger_message_id AS uuid), cast(:trigger_user_id AS uuid),
               :transport, 'running',
               :chain_id, cast(:parent_run_id AS uuid), :depth, cast(:initiated_by AS uuid))
            """
        ),
        {
            "id": run_id,
            "ws": workspace_id,
            "plugin_id": plugin_id,
            "channel_id": channel_id,
            "thread_root_id": thread_root_id,
            "trigger_message_id": trigger_message_id,
            "trigger_user_id": trigger_user_id,
            "transport": transport,
            "chain_id": chain_id,
            "parent_run_id": parent_run_id,
            "depth": depth,
            "initiated_by": initiated_by_user_id,
        },
    )
    return run_id


async def check_budget(session: AsyncSession, *, plugin_id: str) -> str | None:
    """The reason this run must not start, or None.

    The budget is measured in what Blob actually observes — runs begun and wall-clock
    seconds occupied over the trailing 24 hours — because token counts belong to the
    agent's own provider and AG-UI does not carry them. A trailing window rather than a
    calendar day, so the answer never depends on whose midnight.

    Advisory capacity control, not a security boundary: the check and the insert are
    separate statements, so mentions arriving in the same instant can each pass and
    overshoot by the concurrency width. A dam, not a turnstile.
    """
    budgets = (
        await session.execute(
            text("SELECT budget_runs_per_day, budget_seconds_per_day FROM plugins WHERE id = :id"),
            {"id": plugin_id},
        )
    ).fetchone()
    # The common case — no budget set — costs one primary-key lookup and no aggregate.
    if budgets is None or (
        budgets.budget_runs_per_day is None and budgets.budget_seconds_per_day is None
    ):
        return None

    usage = (
        await session.execute(
            text(
                """
                SELECT count(*) AS runs,
                       COALESCE(SUM(EXTRACT(EPOCH FROM
                           (COALESCE(finished_at, now()) - started_at))), 0) AS seconds
                  FROM agent_runs
                 WHERE plugin_id = :plugin_id AND status <> 'refused'
                   AND started_at > now() - interval '24 hours'
                """
            ),
            {"plugin_id": plugin_id},
        )
    ).fetchone()
    runs = int(usage.runs) if usage else 0
    seconds = int(usage.seconds) if usage else 0

    if budgets.budget_runs_per_day is not None and runs >= budgets.budget_runs_per_day:
        return (
            f"Daily budget reached: {budgets.budget_runs_per_day} "
            f"run{'s' if budgets.budget_runs_per_day != 1 else ''} in the last 24 hours."
        )
    if budgets.budget_seconds_per_day is not None and seconds >= budgets.budget_seconds_per_day:
        minutes = max(1, budgets.budget_seconds_per_day // 60)
        plural = "s" if minutes != 1 else ""
        return f"Daily budget reached: {minutes} minute{plural} of run time in the last 24 hours."
    return None


async def record_refusal(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    channel_id: str,
    thread_root_id: str | None,
    trigger_message_id: str,
    trigger_user_id: str | None,
    transport: str,
    reason: str,
) -> str:
    """A run that was never allowed to begin, written down anyway.

    The question agent_runs exists to answer — "I mentioned the agent and nothing
    happened, why?" — applies to a budget refusal more than to anything else, so the
    refusal leaves the same trace a run would. Terminal at birth: refused rows never
    transition, and the budget aggregate excludes them so being refused costs nothing.
    """
    run_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO agent_runs
              (id, workspace_id, plugin_id, channel_id, thread_root_id,
               trigger_message_id, trigger_user_id, transport, status, error, finished_at,
               chain_id, initiated_by_user_id)
            VALUES
              (:id, :ws, :plugin_id, :channel_id, cast(:thread_root_id AS uuid),
               cast(:trigger_message_id AS uuid), cast(:trigger_user_id AS uuid),
               :transport, 'refused', :reason, now(),
               cast(:trigger_message_id AS uuid), cast(:trigger_user_id AS uuid))
            """
        ),
        {
            "id": run_id,
            "ws": workspace_id,
            "plugin_id": plugin_id,
            "channel_id": channel_id,
            "thread_root_id": thread_root_id,
            "trigger_message_id": trigger_message_id,
            "trigger_user_id": trigger_user_id,
            "transport": transport,
            "reason": reason,
        },
    )
    return run_id


async def usage_by_plugin(
    session: AsyncSession, plugin_ids: list[str]
) -> dict[str, tuple[int, int]]:
    """Trailing-day (runs, seconds) per plugin, for the console list. One statement."""
    if not plugin_ids:
        return {}
    rows = (
        await session.execute(
            text(
                """
                SELECT plugin_id, count(*) AS runs,
                       COALESCE(SUM(EXTRACT(EPOCH FROM
                           (COALESCE(finished_at, now()) - started_at))), 0) AS seconds
                  FROM agent_runs
                 WHERE plugin_id = ANY(cast(:ids AS uuid[])) AND status <> 'refused'
                   AND started_at > now() - interval '24 hours'
                 GROUP BY plugin_id
                """
            ),
            {"ids": plugin_ids},
        )
    ).fetchall()
    return {str(row.plugin_id): (int(row.runs), int(row.seconds)) for row in rows}


async def finish(
    session: AsyncSession,
    run_id: str,
    *,
    status: RunStatus,
    error: str | None = None,
    post_count: int = 0,
    card: dict[str, Any] | None = None,
    interrupt: list[dict[str, Any]] | None = None,
    state_json: str | None = None,
    expires_at: Any | None = None,
) -> None:
    """Close the row. For an interrupted run, also keep what a resume will need.

    `interrupt` is stored as `{"items": [...]}` so the answer can be written beside it
    later without a second column. `state_json` is already serialised by the caller —
    `None` means the agent shared no state (or too much), which is distinct from a state
    that happens to be JSON null.
    """
    await session.execute(
        text(
            """
            UPDATE agent_runs
               SET status = :status, error = :error,
                   post_count = :post_count, finished_at = now(),
                   card = COALESCE(cast(:card AS jsonb), card),
                   interrupt = cast(:interrupt AS jsonb),
                   state = cast(:state AS jsonb),
                   expires_at = cast(:expires_at AS timestamptz)
             WHERE id = :id
            """
        ),
        {
            "id": run_id,
            "status": status,
            "error": error,
            "post_count": post_count,
            "card": json.dumps(card) if card is not None else None,
            "interrupt": json.dumps({"items": interrupt}) if interrupt is not None else None,
            "state": state_json,
            "expires_at": expires_at,
        },
    )


async def set_decision_message(session: AsyncSession, run_id: str, message_id: str) -> None:
    """Remember which message carries the buttons, so answering can settle it."""
    await session.execute(
        text("UPDATE agent_runs SET decision_message_id = :m WHERE id = :id"),
        {"m": message_id, "id": run_id},
    )


async def request_cancel_descendants(
    session: AsyncSession, *, workspace_id: str, run_id: str
) -> list[str]:
    """Stop pressed on a run stops the hops it caused, too.

    A chain is one piece of work from the person's side, so Stop on the run they can
    see must not leave the run *it* asked for talking on. Recursive over `parent_run_id`
    so a chain three hops deep ends as one.
    """
    rows = (
        await session.execute(
            text(
                """
                WITH RECURSIVE kin AS (
                    SELECT id FROM agent_runs
                     WHERE parent_run_id = :id AND workspace_id = :ws
                    UNION ALL
                    SELECT r.id FROM agent_runs r JOIN kin ON r.parent_run_id = kin.id
                )
                UPDATE agent_runs
                   SET cancel_requested_at = COALESCE(cancel_requested_at, now())
                 WHERE id IN (SELECT id FROM kin) AND status = 'running'
                RETURNING id
                """
            ),
            {"id": run_id, "ws": workspace_id},
        )
    ).fetchall()
    return [str(row.id) for row in rows]


async def expire_waiting(session: AsyncSession) -> list[dict[str, Any]]:
    """Decisions nobody made in time. Returns what the caller needs to settle their cards.

    `expired` rather than leaving them `interrupted`: the log must tell "still
    answerable" from "nobody answered", the answer route needs one rule, and the buttons
    on the message have to go — which is a state change, not a display trick.
    """
    rows = (
        await session.execute(
            text(
                """
                UPDATE agent_runs
                   SET status = 'expired', finished_at = COALESCE(finished_at, now())
                 WHERE status = 'interrupted' AND answered_at IS NULL
                   AND expires_at IS NOT NULL AND expires_at < now()
                RETURNING id, channel_id, decision_message_id, interrupt
                """
            )
        )
    ).fetchall()
    return [
        {
            "id": str(row.id),
            "channel_id": str(row.channel_id),
            "decision_message_id": (
                str(row.decision_message_id) if row.decision_message_id else None
            ),
            "interrupt": row.interrupt,
        }
        for row in rows
    ]


async def list_for_plugin(
    session: AsyncSession, workspace_id: str, plugin_id: str, limit: int = 30
) -> list[Run]:
    """One app's runs, newest first.

    Scoped by workspace inside the statement rather than trusting the id in the path —
    an app id from another workspace returns nothing rather than somebody else's runs.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT r.id, r.plugin_id, r.channel_id, c.name AS channel_name,
                       r.thread_root_id, r.trigger_message_id,
                       u.display_name AS trigger_user_name,
                       r.transport, r.status, r.error, r.post_count,
                       r.started_at, r.finished_at, r.depth,
                       pp.name AS asked_by
                  FROM agent_runs r
                  LEFT JOIN channels c ON c.id = r.channel_id
                  LEFT JOIN users u ON u.id = r.trigger_user_id
                  LEFT JOIN agent_runs parent ON parent.id = r.parent_run_id
                  LEFT JOIN plugins pp ON pp.id = parent.plugin_id
                 WHERE r.plugin_id = :plugin_id AND r.workspace_id = :ws
                 ORDER BY r.started_at DESC
                 LIMIT :limit
                """
            ),
            {"plugin_id": plugin_id, "ws": workspace_id, "limit": limit},
        )
    ).fetchall()
    return [
        Run(
            id=str(row.id),
            plugin_id=str(row.plugin_id),
            channel_id=str(row.channel_id),
            channel_name=row.channel_name,
            thread_root_id=str(row.thread_root_id) if row.thread_root_id else None,
            trigger_message_id=(str(row.trigger_message_id) if row.trigger_message_id else None),
            trigger_user_name=row.trigger_user_name,
            transport=row.transport,
            status=row.status,
            error=row.error,
            post_count=row.post_count,
            started_at=row.started_at,
            finished_at=row.finished_at,
            depth=row.depth,
            asked_by=row.asked_by if row.depth > 0 else None,
        )
        for row in rows
    ]


async def sweep(session: AsyncSession, keep_days: int = 30) -> int:
    """Drop runs older than the window, and give up on ones that never finished.

    Unbounded by construction otherwise: every mention of an agent writes a row, and
    nothing else would ever remove one. A `running` row past the window is a run whose
    process died mid-call — marking it failed is more honest than leaving it looking
    like it is still going.
    """
    await session.execute(
        text(
            """
            UPDATE agent_runs
               SET status = 'failed', error = 'that run never finished',
                   finished_at = now()
             WHERE status = 'running' AND started_at < now() - interval '1 hour'
            """
        )
    )
    # RETURNING and count the rows: SQLAlchemy's async `Result` has no `rowcount`, which
    # is a trap this codebase has already hit once.
    removed = (
        await session.execute(
            text(
                """
                DELETE FROM agent_runs
                 WHERE started_at < now() - make_interval(days => :days)
                RETURNING id
                """
            ),
            {"days": keep_days},
        )
    ).fetchall()
    return len(removed)


_VIEW_SELECT = """
    SELECT r.id, r.plugin_id, p.name AS agent_name, r.channel_id,
           r.thread_root_id, r.trigger_message_id, r.status, r.error,
           r.post_count, r.started_at, r.finished_at, r.card,
           r.chain_id, r.parent_run_id, r.depth, r.answered_at, r.expires_at,
           pp.name AS asked_by
      FROM agent_runs r
      JOIN plugins p ON p.id = r.plugin_id
      LEFT JOIN agent_runs parent ON parent.id = r.parent_run_id
      LEFT JOIN plugins pp ON pp.id = parent.plugin_id
"""


def _view(row: Any) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "pluginId": str(row.plugin_id),
        "agentName": row.agent_name,
        "channelId": str(row.channel_id),
        "threadRootId": str(row.thread_root_id) if row.thread_root_id else None,
        "triggerMessageId": (str(row.trigger_message_id) if row.trigger_message_id else None),
        "status": row.status,
        "error": row.error,
        "postCount": row.post_count,
        "startedAt": require_iso(row.started_at),
        "finishedAt": require_iso(row.finished_at) if row.finished_at else None,
        "card": row.card,
        "chainId": str(row.chain_id),
        "parentRunId": str(row.parent_run_id) if row.parent_run_id else None,
        "depth": row.depth,
        "askedBy": row.asked_by if row.depth > 0 else None,
        "answeredAt": require_iso(row.answered_at) if row.answered_at else None,
        "expiresAt": require_iso(row.expires_at) if row.expires_at else None,
    }


async def views_for_channel(
    session: AsyncSession, *, workspace_id: str, channel_id: str, limit: int = 10
) -> list[dict[str, Any]]:
    """The runs a conversation view renders on load — live ones plus the recent tail.

    Returned as wire-shaped dicts (the AgentRunView the socket events also carry)
    rather than the console's Run dataclass: the client folds both sources into one
    store slice, and two shapes for the same thing is how they drift.

    A run still waiting on a decision stays listed however old it is: its buttons are
    live for a day, and a card that vanished after an hour while the buttons under it
    still worked would be the confusing half of the feature.
    """
    rows = (
        await session.execute(
            text(
                _VIEW_SELECT
                + """
                 WHERE r.workspace_id = :ws AND r.channel_id = :channel_id
                   AND (r.status = 'running'
                        OR (r.status = 'interrupted' AND r.answered_at IS NULL)
                        OR r.started_at > now() - interval '1 hour')
                 ORDER BY r.started_at DESC
                 LIMIT :limit
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id, "limit": limit},
        )
    ).fetchall()
    return [_view(row) for row in rows]


async def view_of(session: AsyncSession, run_id: str) -> dict[str, Any] | None:
    """One run in the wire shape, for re-announcing it after its state changed."""
    row = (
        await session.execute(text(_VIEW_SELECT + " WHERE r.id = :id"), {"id": run_id})
    ).fetchone()
    return None if row is None else _view(row)


async def request_cancel(
    session: AsyncSession, *, workspace_id: str, run_id: str
) -> dict[str, Any] | None:
    """Mark the ask durable and return what the publisher needs, or None if no such
    running run in this workspace — which is also the cross-tenant answer."""
    row = (
        await session.execute(
            text(
                """
                UPDATE agent_runs
                   SET cancel_requested_at = COALESCE(cancel_requested_at, now())
                 WHERE id = :id AND workspace_id = :ws AND status = 'running'
                RETURNING id, channel_id
                """
            ),
            {"id": run_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None:
        return None
    return {"id": str(row.id), "channelId": str(row.channel_id)}
