"""The decision log: what a conversation settled, recorded where everyone can find it (M2 · A8).

Not `plugins/decisions.py`, which is an agent's question to a person ("Needs a decision").

"A thread that reaches a decision leaves a decision behind." A decision is a row of its own,
rooted in the message it was settled in — the source anyone can go back to — and in that
message's channel, under that channel's membership: a private channel's decisions are as
private as its messages, and a listing joins `channel_members` exactly as search does.

Who records one, and how:

- **A person**, from a message's menu, a thread's summary, or `/decision`. They are
  `decided_by`.
- **An agent proposes; a person decides.** An agent's `record_decision` is always put to
  the person it works for, whatever an admin let its posts do without asking, and is
  recorded in that person's name, with `proposed_by` naming the agent. Captured by an
  agent and approved by a person is the shape every decision log of 2026 settled on, and
  it is the only one that keeps "who decided" true.
- **A person's assistant** over `/api/mcp` is that person (ADR 0016), and records as them.

Revoked, never deleted: a decision that stopped standing is still part of how the team got
where it is. Only the person who recorded it, or an admin, changes or revokes it. Every
write is idempotent on the client's id, and a message is the source of at most one
standing decision — `decisions_message_live`, the index the message list probes to mark a
message as one (`decisionId`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, conflict, forbidden, not_found, unique_violation
from ..lib.ids import new_id
from ..realtime import hub
from . import channels as channel_service
from . import messages as message_service
from .serialize import message_event

TITLE_MAX = 200
RATIONALE_MAX = 2_000
CLIENT_ID_MAX = 200
LIST_MAX = 100


@dataclass(frozen=True, slots=True)
class DecisionView:
    id: str
    channel_id: str
    channel_name: str | None
    channel_kind: str
    message_id: str | None
    thread_root_id: str | None
    title: str
    rationale: str
    decided_by: str | None
    proposed_by: str | None
    proposed_by_name: str | None
    created_at: Any
    updated_at: Any
    revoked_at: Any
    revoked_by: str | None


def clean_title(raw: str) -> str:
    title = " ".join(raw.split())
    if not title:
        raise bad_request("Say what was decided.", code="invalid_input")
    if len(title) > TITLE_MAX:
        raise bad_request(
            f"A decision is one line of at most {TITLE_MAX} characters; put the rest in why.",
            code="invalid_input",
        )
    return title


def clean_rationale(raw: str | None) -> str:
    rationale = (raw or "").strip()
    if len(rationale) > RATIONALE_MAX:
        raise bad_request(
            f"Why it was decided is at most {RATIONALE_MAX} characters.", code="invalid_input"
        )
    return rationale


_SELECT = """
    SELECT d.id, d.channel_id, c.name AS channel_name, c.kind AS channel_kind,
           d.message_id, d.thread_root_id, d.title, d.rationale, d.decided_by,
           d.proposed_by, p.name AS proposed_by_name, d.created_at, d.updated_at,
           d.revoked_at, d.revoked_by
      FROM decisions d
      JOIN channels c ON c.id = d.channel_id
      LEFT JOIN plugins p ON p.id = d.proposed_by
"""


def _view(row: Any) -> DecisionView:
    return DecisionView(
        id=str(row.id),
        channel_id=str(row.channel_id),
        channel_name=row.channel_name,
        channel_kind=row.channel_kind,
        message_id=str(row.message_id) if row.message_id else None,
        thread_root_id=str(row.thread_root_id) if row.thread_root_id else None,
        title=row.title,
        rationale=row.rationale,
        decided_by=str(row.decided_by) if row.decided_by else None,
        proposed_by=str(row.proposed_by) if row.proposed_by else None,
        proposed_by_name=row.proposed_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
        revoked_by=str(row.revoked_by) if row.revoked_by else None,
    )


async def _by_id(session: AsyncSession, decision_id: str) -> DecisionView | None:
    row = (await session.execute(text(f"{_SELECT} WHERE d.id = :id"), {"id": decision_id})).first()
    return _view(row) if row is not None else None


async def view_for(session: AsyncSession, user_id: str, decision_id: str) -> DecisionView:
    """One decision, for somebody who may read its channel — and a 404, as the channel
    would answer, for anybody else."""
    found = await _by_id(session, decision_id)
    if found is None:
        raise not_found("There is no such decision.")
    await channel_service.assert_channel_access(
        session, user_id, found.channel_id, require_member=True
    )
    return found


async def record(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    channel_id: str,
    title: str,
    rationale: str | None = None,
    message_id: str | None = None,
    client_id: str,
    proposed_by: str | None = None,
) -> tuple[DecisionView, bool]:
    """Record a decision in a channel, in `user_id`'s name. Answers it, and whether this
    call made it — a repeat of the same client id answers the one already made.

    The person must be able to write in the channel: recording changes the channel's
    record, the way a pin does. A source message must be in that channel and not deleted.
    """
    cleaned = clean_title(title)
    why = clean_rationale(rationale)
    key = client_id.strip()
    if not key or len(key) > CLIENT_ID_MAX:
        raise bad_request("A decision needs a client id.", code="invalid_input")
    await channel_service.assert_channel_access(
        session, user_id, channel_id, require_member=True, require_writable=True
    )

    existing = (
        await session.execute(
            text(
                "SELECT id, decided_by FROM decisions WHERE workspace_id = :ws AND client_id = :key"
            ),
            {"ws": workspace_id, "key": key},
        )
    ).first()
    if existing is not None:
        if str(existing.decided_by) != user_id:
            raise conflict("That id was already used for another decision.", "client_id_taken")
        found = await _by_id(session, str(existing.id))
        if found is None:  # pragma: no cover — a row read a statement ago
            raise not_found("There is no such decision.")
        return found, False

    thread_root_id: str | None = None
    if message_id is not None:
        source = (
            await session.execute(
                text(
                    """
                    SELECT id, channel_id, thread_root_id, deleted_at FROM messages
                     WHERE id = :id
                    """
                ),
                {"id": message_id},
            )
        ).first()
        if source is None or str(source.channel_id) != channel_id or source.deleted_at:
            raise not_found("There is no such message in that conversation.")
        thread_root_id = str(source.thread_root_id) if source.thread_root_id else None
        standing = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM decisions WHERE message_id = :id AND revoked_at IS NULL
                    """
                ),
                {"id": message_id},
            )
        ).first()
        if standing is not None:
            raise conflict("That message is already a decision.", "already_decided")

    decision_id = new_id()
    try:
        await session.execute(
            text(
                """
                INSERT INTO decisions
                       (id, workspace_id, channel_id, message_id, thread_root_id, title,
                        rationale, decided_by, proposed_by, client_id)
                VALUES (:id, :ws, :channel, :message, :thread, :title, :why, :by,
                        :proposed, :key)
                """
            ),
            {
                "id": decision_id,
                "ws": workspace_id,
                "channel": channel_id,
                "message": message_id,
                "thread": thread_root_id,
                "title": cleaned,
                "why": why,
                "by": user_id,
                "proposed": proposed_by,
                "key": key,
            },
        )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict("That message is already a decision.", "already_decided") from exc
        raise
    made = await _by_id(session, decision_id)
    if made is None:  # pragma: no cover — inserted a statement ago
        raise not_found("There is no such decision.")
    return made, True


def _like(needle: str) -> str:
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def list_for(
    session: AsyncSession,
    *,
    user_id: str,
    workspace_id: str,
    channel_id: str | None = None,
    query: str | None = None,
    include_revoked: bool = False,
    audience: str | None = None,
    before: str | None = None,
    limit: int = 50,
) -> list[DecisionView]:
    """Decisions in the channels this person is in, newest first.

    Membership is the boundary, as it is for search. `audience` is the room ceiling for an
    agent (ADR 0022): that room and public channels, and nothing else. Keyset on the id,
    which is a UUIDv7 and sorts by when the decision was recorded.
    """
    needle = " ".join((query or "").split()) or None
    rows = (
        await session.execute(
            text(
                f"""
                {_SELECT}
                  JOIN channel_members cm
                    ON cm.channel_id = d.channel_id
                   AND cm.user_id = :user          -- the security boundary
                 WHERE d.workspace_id = :ws
                   AND (CAST(:channel AS uuid) IS NULL OR d.channel_id = CAST(:channel AS uuid))
                   AND (CAST(:revoked AS boolean) OR d.revoked_at IS NULL)
                   AND (CAST(:needle AS text) IS NULL
                        OR d.title ILIKE CAST(:needle AS text) ESCAPE '\\'
                        OR d.rationale ILIKE CAST(:needle AS text) ESCAPE '\\')
                   AND (CAST(:audience AS uuid) IS NULL
                        OR d.channel_id = CAST(:audience AS uuid)
                        OR c.kind = 'public')
                   AND (CAST(:before AS uuid) IS NULL OR d.id < CAST(:before AS uuid))
                 ORDER BY d.id DESC
                 LIMIT :limit
                """
            ),
            {
                "user": user_id,
                "ws": workspace_id,
                "channel": channel_id,
                "revoked": include_revoked,
                "needle": _like(needle) if needle else None,
                "audience": audience,
                "before": before,
                "limit": max(1, min(limit, LIST_MAX)),
            },
        )
    ).fetchall()
    return [_view(row) for row in rows]


async def _may_change(session: AsyncSession, user_id: str, found: DecisionView) -> None:
    """The person who recorded it, or an admin of the workspace."""
    if found.decided_by == user_id:
        return
    role = (
        await session.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user_id})
    ).scalar_one_or_none()
    if role not in ("admin", "owner"):
        raise forbidden("Only the person who recorded it, or an admin, can change it.")


async def change(
    session: AsyncSession,
    user_id: str,
    decision_id: str,
    *,
    title: str | None = None,
    rationale: str | None = None,
) -> DecisionView:
    found = await view_for(session, user_id, decision_id)
    await _may_change(session, user_id, found)
    await session.execute(
        text(
            """
            UPDATE decisions
               SET title = COALESCE(:title, title),
                   rationale = COALESCE(:why, rationale),
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": decision_id,
            "title": clean_title(title) if title is not None else None,
            "why": clean_rationale(rationale) if rationale is not None else None,
        },
    )
    return await view_for(session, user_id, decision_id)


async def revoke(
    session: AsyncSession, user_id: str, decision_id: str, *, revoked: bool = True
) -> DecisionView:
    """Mark it as no longer standing — or standing again. Restoring one whose message has
    since become another decision's source is refused rather than leaving two."""
    found = await view_for(session, user_id, decision_id)
    await _may_change(session, user_id, found)
    try:
        await session.execute(
            text(
                """
                UPDATE decisions
                   SET revoked_at = CASE WHEN :revoked
                                         THEN COALESCE(revoked_at, now()) END,
                       revoked_by = CASE WHEN :revoked
                                         THEN COALESCE(revoked_by, CAST(:by AS uuid)) END,
                       updated_at = now()
                 WHERE id = :id
                """
            ),
            {"id": decision_id, "revoked": revoked, "by": user_id},
        )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict(
                "That message has become another decision since; it cannot stand twice.",
                "already_decided",
            ) from exc
        raise
    return await view_for(session, user_id, decision_id)


async def announce_source(session: AsyncSession, after: Any, found: DecisionView) -> None:
    """Tell the channel its source message changed, past COMMIT — the message now says
    it is a decision, or no longer does. Nothing to tell for one with no source."""
    if found.message_id is None:
        return
    message = await message_service.by_id(session, found.message_id)
    if message is None:
        return
    after.add(lambda: hub.to_channel(message.channel_id, message_event("message.updated", message)))


__all__ = [
    "LIST_MAX",
    "RATIONALE_MAX",
    "TITLE_MAX",
    "DecisionView",
    "announce_source",
    "change",
    "clean_rationale",
    "clean_title",
    "list_for",
    "record",
    "revoke",
    "view_for",
]
