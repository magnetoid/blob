"""Notes an agent keeps, in words people can read (M2 · A8).

Beside the AG-UI state blob (`services/agent_state.py`), which an agent writes for itself and
nobody reads sensibly, a note is a sentence an agent chose to remember — through Blob's
`remember` tool — and so something a person can read, correct and remove.

**Whose a note is** is ADR 0024's answer for memory, unchanged: the key is (agent,
conversation, person), with the person NULL for the workspace's agent — the conversation's
notes — and the person a run is for when the agent is somebody's own. A loan lends the
agent, not what it noted of its owner.

**Who sees them**, likewise: a person sees and edits their own notes in Settings; an admin
sees and edits the workspace's agents' conversation notes on the agent's page, only in
conversations they can see — a note is made of what was said in the room — and never a
person's own. A note in a conversation's scope is handed to that conversation's next runs
(`context_for`), newest first, as far as a modest budget goes; `recall` finds older ones.

**It ends**, as a memory does: a scope nobody has written a note in for ninety days goes in
the nightly sweep, and a deleted channel, agent or person takes its notes with it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id

NOTE_MAX = 500
#: Notes one scope may hold. Past it, the agent is told to forget one first rather than
#: Blob dropping the oldest behind its back: what it keeps is its decision.
NOTES_PER_SCOPE = 200
#: What a run is handed of its notes up front, newest first.
CONTEXT_NOTES = 20
CONTEXT_CHARS = 4_000
RECALL_MAX = 50
KEEP_DAYS = 90


@dataclass(frozen=True, slots=True)
class Scope:
    """Whose notes: one agent's, in one conversation, for nobody (the conversation's) or
    for one person (`Listener.memory_of`)."""

    workspace_id: str
    plugin_id: str
    channel_id: str
    person_id: str | None


@dataclass(frozen=True, slots=True)
class Note:
    id: str
    body: str
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class ListedNote:
    """A note as Settings or the agent's page lists it: where, whose agent, when."""

    id: str
    plugin_id: str
    agent_name: str
    channel_id: str
    channel_name: str | None
    channel_kind: str
    body: str
    updated_at: Any


def clean_body(raw: str) -> str:
    body = raw.strip()
    if not body:
        raise bad_request("A note needs something in it.", code="invalid_input")
    if len(body) > NOTE_MAX:
        raise bad_request(f"A note is at most {NOTE_MAX} characters.", code="invalid_input")
    return body


_IN_SCOPE = """
    workspace_id = :ws AND plugin_id = :plugin AND channel_id = :channel
    AND person_id IS NOT DISTINCT FROM CAST(:person AS uuid)
"""


def _params(scope: Scope) -> dict[str, Any]:
    return {
        "ws": scope.workspace_id,
        "plugin": scope.plugin_id,
        "channel": scope.channel_id,
        "person": scope.person_id,
    }


async def keep(session: AsyncSession, scope: Scope, body: str) -> Note:
    """Keep a note. Refused, in words the agent can act on, once the scope is full."""
    cleaned = clean_body(body)
    held = (
        await session.execute(
            text(f"SELECT count(*) FROM agent_notes WHERE {_IN_SCOPE}"), _params(scope)
        )
    ).scalar_one()
    if int(held) >= NOTES_PER_SCOPE:
        raise bad_request(
            f"You keep {NOTES_PER_SCOPE} notes here already; forget one you no longer need first.",
            code="notes_full",
        )
    note_id = new_id()
    row = (
        await session.execute(
            text(
                """
                INSERT INTO agent_notes (id, workspace_id, plugin_id, channel_id, person_id, body)
                VALUES (:id, :ws, :plugin, :channel, :person, :body)
                RETURNING id, body, created_at, updated_at
                """
            ),
            {**_params(scope), "id": note_id, "body": cleaned},
        )
    ).one()
    return Note(str(row.id), row.body, row.created_at, row.updated_at)


def _like(needle: str) -> str:
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def recall(
    session: AsyncSession, scope: Scope, *, query: str | None = None, limit: int = RECALL_MAX
) -> list[Note]:
    """Notes in this scope, newest first — those whose words match, when asked."""
    needle = " ".join((query or "").split()) or None
    rows = (
        await session.execute(
            text(
                f"""
                SELECT id, body, created_at, updated_at FROM agent_notes
                 WHERE {_IN_SCOPE}
                   AND (CAST(:needle AS text) IS NULL
                        OR body ILIKE CAST(:needle AS text) ESCAPE '\\')
                 ORDER BY created_at DESC, id DESC
                 LIMIT :limit
                """
            ),
            {
                **_params(scope),
                "needle": _like(needle) if needle else None,
                "limit": max(1, min(limit, RECALL_MAX)),
            },
        )
    ).fetchall()
    return [Note(str(r.id), r.body, r.created_at, r.updated_at) for r in rows]


async def forget(session: AsyncSession, scope: Scope, note_id: str) -> bool:
    """Forget one of this scope's notes. False when there is no such note in it."""
    gone = (
        await session.execute(
            text(
                f"DELETE FROM agent_notes WHERE id = CAST(:id AS uuid) AND {_IN_SCOPE} RETURNING id"
            ),
            {**_params(scope), "id": note_id},
        )
    ).first()
    return gone is not None


async def context_for(scope: Scope) -> str | None:
    """What a run in this scope is handed of its notes: the newest, a line each, as far as
    the budget goes. None when it keeps none."""
    async with session_scope() as session:
        notes = await recall(session, scope, limit=CONTEXT_NOTES)
    if not notes:
        return None
    lines: list[str] = []
    size = 0
    for note in notes:
        line = f"- {' '.join(note.body.split())} (note {note.id})"
        if size + len(line) > CONTEXT_CHARS:
            break
        lines.append(line)
        size += len(line) + 1
    return "\n".join(lines)


# ─── what people see of them ─────────────────────────────────────────────────────────

_LISTED = """
    SELECT n.id, n.plugin_id, p.name AS agent_name, n.channel_id, c.name AS channel_name,
           c.kind AS channel_kind, n.body, n.updated_at
      FROM agent_notes n
      JOIN plugins p ON p.id = n.plugin_id
      JOIN channels c ON c.id = n.channel_id
"""


def _listed(row: Any) -> ListedNote:
    return ListedNote(
        id=str(row.id),
        plugin_id=str(row.plugin_id),
        agent_name=row.agent_name,
        channel_id=str(row.channel_id),
        channel_name=row.channel_name,
        channel_kind=row.channel_kind,
        body=row.body,
        updated_at=row.updated_at,
    )


async def for_person(
    session: AsyncSession, *, workspace_id: str, person_id: str
) -> list[ListedNote]:
    """What agents noted of this person's own conversations with them — an agent they own,
    or one lent to them. Newest first."""
    rows = (
        await session.execute(
            text(
                _LISTED
                + """
                 WHERE n.workspace_id = :ws AND n.person_id = :me
                 ORDER BY n.updated_at DESC
                 LIMIT 500
                """
            ),
            {"ws": workspace_id, "me": person_id},
        )
    ).fetchall()
    return [_listed(row) for row in rows]


#: An admin's view: the workspace's agent's conversation notes, in conversations they can
#: see. An owned agent's notes are people's, and never listed to an admin.
_ADMIN_SEES = """
    n.workspace_id = :ws AND n.plugin_id = :plugin AND n.person_id IS NULL
    AND p.owner_user_id IS NULL
    AND (
      (c.kind = 'public' AND NOT EXISTS (
          SELECT 1 FROM users viewer
           WHERE viewer.id = :viewer AND viewer.role = 'guest'
      ))
      OR EXISTS (
        SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = :viewer
      )
    )
"""

#: A person's view: their own notes, and nobody else's.
_OWN_NOTES = "n.workspace_id = :ws AND n.person_id = :me"


async def for_conversations(
    session: AsyncSession, *, workspace_id: str, plugin_id: str, viewer_id: str
) -> list[ListedNote]:
    rows = (
        await session.execute(
            text(_LISTED + f" WHERE {_ADMIN_SEES} ORDER BY n.updated_at DESC LIMIT 500"),
            {"ws": workspace_id, "plugin": plugin_id, "viewer": viewer_id},
        )
    ).fetchall()
    return [_listed(row) for row in rows]


async def _change(
    session: AsyncSession, *, admin: bool, params: dict[str, Any], body: str | None
) -> ListedNote:
    """Reword (`body`) or forget (None) one note — an admin's view of the conversation notes,
    or a person's of their own. 404 when it is outside that view: a note somebody cannot see
    answers as one that does not exist."""
    found = (
        await session.execute(
            text(
                _LISTED
                + f" WHERE {_ADMIN_SEES if admin else _OWN_NOTES} AND n.id = CAST(:id AS uuid)"
            ),
            params,
        )
    ).first()
    if found is None:
        raise not_found("That note is already gone.")
    if body is None:
        await session.execute(
            text("DELETE FROM agent_notes WHERE id = CAST(:id AS uuid)"), {"id": params["id"]}
        )
        return _listed(found)
    await session.execute(
        text(
            "UPDATE agent_notes SET body = :body, updated_at = now() WHERE id = CAST(:id AS uuid)"
        ),
        {"id": params["id"], "body": clean_body(body)},
    )
    changed = (
        await session.execute(
            text(_LISTED + " WHERE n.id = CAST(:id AS uuid)"), {"id": params["id"]}
        )
    ).one()
    return _listed(changed)


async def change_own(
    session: AsyncSession, *, workspace_id: str, person_id: str, note_id: str, body: str | None
) -> ListedNote:
    """A person rewords or forgets one of their own notes."""
    return await _change(
        session,
        admin=False,
        params={"ws": workspace_id, "me": person_id, "id": note_id},
        body=body,
    )


async def change_conversation(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    viewer_id: str,
    note_id: str,
    body: str | None,
) -> ListedNote:
    """An admin rewords or forgets one conversation note they can see."""
    return await _change(
        session,
        admin=True,
        params={"ws": workspace_id, "plugin": plugin_id, "viewer": viewer_id, "id": note_id},
        body=body,
    )


async def sweep(session: AsyncSession, *, keep_days: int = KEEP_DAYS) -> int:
    """End every scope nobody has written a note in for `keep_days`: the conversation's
    notes go together, as a memory does, rather than the oldest fact first."""
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM agent_notes n
                 USING (
                   SELECT plugin_id, channel_id, person_id
                     FROM agent_notes
                    GROUP BY plugin_id, channel_id, person_id
                   HAVING max(updated_at) < now() - make_interval(days => :days)
                 ) quiet
                 WHERE n.plugin_id = quiet.plugin_id
                   AND n.channel_id = quiet.channel_id
                   AND n.person_id IS NOT DISTINCT FROM quiet.person_id
                RETURNING n.id
                """
            ),
            {"days": keep_days},
        )
    ).fetchall()
    return len(rows)


__all__ = [
    "CONTEXT_NOTES",
    "KEEP_DAYS",
    "NOTES_PER_SCOPE",
    "NOTE_MAX",
    "ListedNote",
    "Note",
    "Scope",
    "change_conversation",
    "change_own",
    "clean_body",
    "context_for",
    "for_conversations",
    "for_person",
    "forget",
    "keep",
    "recall",
    "sweep",
]
