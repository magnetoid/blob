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

from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id

RunStatus = Literal["running", "succeeded", "failed", "interrupted"]


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
) -> str:
    """Record that a run began, before the agent is called.

    Written first on purpose: a run that never returns — a process killed mid-call, an
    agent that hangs past every timeout — is exactly the case with nothing to show for
    it, and it is the one that leaves a `running` row behind to say so.
    """
    run_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO agent_runs
              (id, workspace_id, plugin_id, channel_id, thread_root_id,
               trigger_message_id, trigger_user_id, transport, status)
            VALUES
              (:id, :ws, :plugin_id, :channel_id, cast(:thread_root_id AS uuid),
               cast(:trigger_message_id AS uuid), cast(:trigger_user_id AS uuid),
               :transport, 'running')
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
        },
    )
    return run_id


async def finish(
    session: AsyncSession,
    run_id: str,
    *,
    status: RunStatus,
    error: str | None = None,
    post_count: int = 0,
) -> None:
    await session.execute(
        text(
            """
            UPDATE agent_runs
               SET status = :status, error = :error,
                   post_count = :post_count, finished_at = now()
             WHERE id = :id
            """
        ),
        {"id": run_id, "status": status, "error": error, "post_count": post_count},
    )


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
                       r.started_at, r.finished_at
                  FROM agent_runs r
                  LEFT JOIN channels c ON c.id = r.channel_id
                  LEFT JOIN users u ON u.id = r.trigger_user_id
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
