"""What an agent remembers, per conversation — and whose memory it is.

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

Whose it is (migration 0050): the workspace's agent keeps the conversation's memory
(`person_id` NULL), used by anyone's run there. An agent somebody owns keeps one per
person — its owner's, and each borrower's own — so a loan lends the agent and not what it
knows. A person sees and clears their own in Settings; an admin sees and clears the
conversations' memories of the workspace's agents, in conversations they can see.

Memories nobody has touched for `KEEP_DAYS` go in the nightly sweep: the table grew one
row per agent per conversation for ever, and an agent handed a plan from months ago is
not remembering, it is confused.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id
from ..schemas.base import require_iso
from ..schemas.models import AgentMemory

#: How long a memory lasts after its last write.
KEEP_DAYS = 90

#: How much of a memory a list shows of it. The whole of it is at most 64 KiB.
PREVIEW_CHARS = 2_000


async def load(
    session: AsyncSession, *, plugin_id: str, thread_key: str, person_id: str | None
) -> Any | None:
    row = (
        await session.execute(
            text(
                """
                SELECT state FROM agent_state
                 WHERE plugin_id = :p AND thread_key = :t
                   AND person_id IS NOT DISTINCT FROM cast(:person AS uuid)
                """
            ),
            {"p": plugin_id, "t": thread_key, "person": person_id},
        )
    ).fetchone()
    return None if row is None else row.state


async def save(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    channel_id: str,
    thread_key: str,
    person_id: str | None,
    state_json: str,
) -> None:
    """Replace what the agent remembers here, for whoever it is remembered for.
    `state_json` is already serialised and already under the fold's size cap — the caller
    checked, because it is the caller that knows whether the state was dropped mid-run."""
    await session.execute(
        text(
            """
            INSERT INTO agent_state
                (id, plugin_id, thread_key, channel_id, person_id, workspace_id, state)
            VALUES (:id, :p, :t, :c, cast(:person AS uuid), :ws, cast(:state AS jsonb))
            ON CONFLICT (plugin_id, thread_key, person_id) DO UPDATE
               SET state = EXCLUDED.state, updated_at = now()
            """
        ),
        {
            "id": new_id(),
            "p": plugin_id,
            "t": thread_key,
            "c": channel_id,
            "person": person_id,
            "ws": workspace_id,
            "state": state_json,
        },
    )


_LISTED = f"""
    SELECT s.id, s.plugin_id, p.name AS agent_name, s.channel_id, c.name AS channel_name,
           c.kind AS channel_kind, s.thread_key <> s.channel_id AS in_thread, s.updated_at,
           octet_length(s.state::text) AS size,
           left(s.state::text, {PREVIEW_CHARS}) AS preview
      FROM agent_state s
      JOIN plugins p ON p.id = s.plugin_id
      JOIN channels c ON c.id = s.channel_id
"""


def _memory(row: Any) -> AgentMemory:
    return AgentMemory(
        id=str(row.id),
        plugin_id=str(row.plugin_id),
        agent_name=row.agent_name,
        channel_id=str(row.channel_id),
        channel_name=row.channel_name,
        channel_kind=row.channel_kind,
        in_thread=bool(row.in_thread),
        updated_at=require_iso(row.updated_at),
        size=int(row.size or 0),
        preview=row.preview or "",
    )


async def for_person(
    session: AsyncSession, *, workspace_id: str, person_id: str
) -> list[AgentMemory]:
    """What agents remember of this person's own conversations with them: an owned
    agent's memory of its owner, and of each borrower. Newest first."""
    rows = (
        await session.execute(
            text(
                _LISTED
                + """
                 WHERE s.workspace_id = :ws AND s.person_id = :me
                 ORDER BY s.updated_at DESC
                 LIMIT 200
                """
            ),
            {"ws": workspace_id, "me": person_id},
        )
    ).fetchall()
    return [_memory(row) for row in rows]


async def for_conversations(
    session: AsyncSession, *, workspace_id: str, plugin_id: str, viewer_id: str
) -> list[AgentMemory]:
    """One agent's memories of conversations — the ones nobody owns — in conversations the
    viewer can see. For an admin: a memory is made of what was said in the room, so a
    private room the admin is not in keeps its memory out of their sight as it keeps its
    messages."""
    rows = (
        await session.execute(
            text(
                _LISTED
                + """
                 WHERE s.workspace_id = :ws AND s.plugin_id = :p AND s.person_id IS NULL
                   -- The workspace's agent only. An owned agent's memory is people's, and a
                   -- row of one with no person — written before it had an owner, say — is
                   -- not the admin's to read either (review of phase 5).
                   AND p.owner_user_id IS NULL
                   AND (
                     (c.kind = 'public' AND NOT EXISTS (
                         SELECT 1 FROM users viewer
                          WHERE viewer.id = :viewer AND viewer.role = 'guest'
                     ))
                     OR EXISTS (
                       SELECT 1 FROM channel_members cm
                        WHERE cm.channel_id = c.id AND cm.user_id = :viewer
                     )
                   )
                 ORDER BY s.updated_at DESC
                 LIMIT 200
                """
            ),
            {"ws": workspace_id, "p": plugin_id, "viewer": viewer_id},
        )
    ).fetchall()
    return [_memory(row) for row in rows]


async def forget_own(
    session: AsyncSession, *, workspace_id: str, person_id: str, memory_id: str | None
) -> int:
    """Clear one of this person's memories, or every one of them (`memory_id` None).
    Only their own: a memory of somebody else's, or of a conversation, is not found."""
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM agent_state
                 WHERE workspace_id = :ws AND person_id = :me
                   AND (cast(:id AS uuid) IS NULL OR id = cast(:id AS uuid))
                RETURNING id
                """
            ),
            {"ws": workspace_id, "me": person_id, "id": memory_id},
        )
    ).fetchall()
    return len(rows)


async def forget_conversations(
    session: AsyncSession, *, workspace_id: str, plugin_id: str, memory_id: str | None
) -> int:
    """Clear one of an agent's conversation memories, or all of them — what an admin does
    to an agent that has learned something wrong. Never a person's own memory."""
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM agent_state
                 WHERE workspace_id = :ws AND plugin_id = :p AND person_id IS NULL
                   AND plugin_id IN (SELECT id FROM plugins WHERE owner_user_id IS NULL)
                   AND (cast(:id AS uuid) IS NULL OR id = cast(:id AS uuid))
                RETURNING id
                """
            ),
            {"ws": workspace_id, "p": plugin_id, "id": memory_id},
        )
    ).fetchall()
    return len(rows)


async def sweep(session: AsyncSession, *, keep_days: int = KEEP_DAYS) -> int:
    """Memories nobody has written for `keep_days`. Answers how many went."""
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM agent_state
                 WHERE updated_at < now() - make_interval(days => :days)
                RETURNING id
                """
            ),
            {"days": keep_days},
        )
    ).fetchall()
    return len(rows)


__all__ = [
    "KEEP_DAYS",
    "for_conversations",
    "for_person",
    "forget_conversations",
    "forget_own",
    "load",
    "save",
    "sweep",
]
