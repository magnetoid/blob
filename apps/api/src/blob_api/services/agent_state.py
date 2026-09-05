"""What an agent remembers, per conversation.

AG-UI carries an agent's shared state as a snapshot and deltas. Blob folds those during a
run (`plugins/agui.Fold`) and, since 0026, hands the fold back when a run resumes. This is
the same fold kept *past* the run: the last state an agent left in a conversation is what
it is given at the start of its next run there, so an agent that keeps a plan, a list of
open items, or what it has already checked does not start from nothing every time it is
mentioned.

A conversation is what AG-UI calls the thread — a thread root's id, or the channel's id
outside a thread — and the state is per agent, so two agents in one channel keep their
own. Replaced whole, never merged: the snapshot the agent sent already is everything it
wants kept. Only a run that actually shared state writes here; a run that shared nothing
leaves the memory as it was.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def load(session: AsyncSession, *, plugin_id: str, thread_key: str) -> Any | None:
    row = (
        await session.execute(
            text("SELECT state FROM agent_state WHERE plugin_id = :p AND thread_key = :t"),
            {"p": plugin_id, "t": thread_key},
        )
    ).fetchone()
    return None if row is None else row.state


async def save(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    thread_key: str,
    state_json: str,
) -> None:
    """Replace what the agent remembers here. `state_json` is already serialised and
    already under the fold's size cap — the caller checked, because it is the caller that
    knows whether the state was dropped mid-run."""
    await session.execute(
        text(
            """
            INSERT INTO agent_state (plugin_id, thread_key, workspace_id, state)
            VALUES (:p, :t, :ws, cast(:state AS jsonb))
            ON CONFLICT (plugin_id, thread_key) DO UPDATE
               SET state = EXCLUDED.state, updated_at = now()
            """
        ),
        {"p": plugin_id, "t": thread_key, "ws": workspace_id, "state": state_json},
    )


async def forget(session: AsyncSession, *, plugin_id: str, thread_key: str | None = None) -> int:
    """Drop what an agent remembers — everywhere, or in one conversation."""
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM agent_state
                 WHERE plugin_id = :p
                   AND (cast(:t AS uuid) IS NULL OR thread_key = cast(:t AS uuid))
                RETURNING thread_key
                """
            ),
            {"p": plugin_id, "t": thread_key},
        )
    ).fetchall()
    return len(rows)


__all__ = ["forget", "load", "save"]
