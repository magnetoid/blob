"""An agent coming back to a conversation later (ADR 0040).

`schedule_followup` lets an agent answering somebody wait until a time it names and carry
on then, in the same conversation and for the same person, instead of guessing now or
leaving them to ask again. It is the run waiting, the way a run waits on another agent's
answer (`agui_delegate`, M2 · A2): it ends its round `waiting`, holding no worker and
keeping its tool exchange, and `jobs/agui._hear` carries it on as a resume once the time
has come, with the note as the call's result.

What is new is only what a wait of days needs that a wait of a quarter hour did not: bounds
on what may be asked for, and asking again on waking whether the person still may.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from ..db.engine import fetch_one, session_scope
from ..plugins.agui import ToolCall
from ..schemas.base import require_iso
from ..services import agent_access
from ..services.workspace_settings import parse as parse_settings
from .agui_tools import ToolOutcome

#: What the wait is kept under, in `agent_runs.interrupt.kind`.
KIND = "come_back"
#: The nearest and the furthest a follow-up may be.
MIN_AHEAD = timedelta(minutes=1)
MAX_AHEAD = timedelta(days=14)
#: How many times one chain may come back, so "tomorrow" cannot become every day for ever.
MAX_PER_CHAIN = 5
#: A note says what for, in a line or two.
MAX_NOTE_CHARS = 500


@dataclass(frozen=True, slots=True)
class ComeBack:
    """A follow-up the agent asked for, checked: when, and what for."""

    until: datetime
    note: str

    def as_dict(self) -> dict[str, str]:
        return {"until": require_iso(self.until), "note": self.note}


def parse_when(raw: object) -> datetime | None:
    """An ISO 8601 time that says its offset, in UTC; None for anything else. A time
    without an offset is refused rather than guessed: noon where?"""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


async def plan(
    call: ToolCall, *, chain_id: str, now: datetime | None = None
) -> ToolOutcome | ComeBack:
    """Check a `schedule_followup` call. A refusal is a result the agent reads and can act
    on, never a failure of the run."""
    arguments = call.parsed_arguments()
    if arguments is None:
        return ToolOutcome("", "The arguments must be a JSON object with `when` and `note`.")
    note = arguments.get("note")
    if not isinstance(note, str) or not note.strip():
        return ToolOutcome("", "Say what you will do when you come back, in `note`.")
    note = note.strip()
    if len(note) > MAX_NOTE_CHARS:
        return ToolOutcome("", f"The note is {len(note)} characters; keep it to {MAX_NOTE_CHARS}.")
    until = parse_when(arguments.get("when"))
    if until is None:
        return ToolOutcome(
            "",
            "`when` must be an ISO 8601 date and time with its offset, like "
            "2026-10-24T10:00:00+02:00.",
        )
    now = now or datetime.now(UTC)
    if until < now + MIN_AHEAD:
        return ToolOutcome("", "That is not in the future: come back at least a minute from now.")
    if until > now + MAX_AHEAD:
        return ToolOutcome("", "That is too far ahead: come back within 14 days.")
    async with session_scope() as session:
        row = await fetch_one(
            session,
            """
            SELECT count(*) AS n FROM agent_runs
             WHERE chain_id = :chain AND interrupt ->> 'kind' = :kind
            """,
            {"chain": chain_id, "kind": KIND},
        )
    if row is not None and int(row.n) >= MAX_PER_CHAIN:
        return ToolOutcome(
            "",
            f"This conversation has already come back {MAX_PER_CHAIN} times. Say what is "
            "still open instead, and let the person ask again when they want.",
        )
    return ComeBack(until=until, note=note)


def woken(stored: dict[str, Any], now: datetime | None = None) -> ToolOutcome | None:
    """What a run coming back is told, or None while its time has not come yet."""
    raw = stored.get("comes_back")
    comes_back: dict[str, Any] = raw if isinstance(raw, dict) else {}
    until = parse_when(comes_back.get("until"))
    if until is None:
        return ToolOutcome("", "The time this run was to come back could not be read.")
    if until > (now or datetime.now(UTC)):
        return None
    note = str(comes_back.get("note") or "").strip() or "(no note)"
    return ToolOutcome(
        "It is time to come back to this conversation. Your note: "
        f"{note}\n\nRead what has been said here since you left it, then carry on."
    )


async def no_longer(session: Any, waiting: Any) -> str | None:
    """Why a run may not come back now, in words for its card — or None if it may.

    Days can pass between the call and the waking, so what a wait of a quarter hour never
    had to ask is asked again: whether the person is still here, still in the room, still
    allowed this agent, and whether agents are still on.
    """
    person = str(waiting.initiated_by_user_id)
    found = (
        await session.execute(
            text(
                """
                SELECT u.display_name, u.deactivated_at, u.role, c.archived_at, s.settings,
                       EXISTS (
                         SELECT 1 FROM channel_members m
                          WHERE m.channel_id = c.id AND m.user_id = u.id
                       ) AS in_room
                  FROM users u
                  JOIN channels c ON c.id = :channel
                  LEFT JOIN workspace_settings s ON s.workspace_id = c.workspace_id
                 WHERE u.id = :person
                """
            ),
            {"person": person, "channel": str(waiting.channel_id)},
        )
    ).first()
    if found is None:
        return "the person it was for is gone"
    who = found.display_name or "the person it was for"
    if found.deactivated_at is not None:
        return f"{who}'s account was deactivated"
    if found.role == "guest":
        # A guest's message starts no run (ADR 0034), and a member's run is not a way
        # round that once they are made one.
        return f"{who} is now a guest"
    if not parse_settings(found.settings).agents_enabled:
        return "agents are turned off for this server"
    if found.archived_at is not None:
        return "the conversation was archived"
    if not found.in_room:
        return f"{who} is no longer in this conversation"
    bot = str(waiting.bot_user_id)
    allowed = await agent_access.commandable_by(
        session,
        workspace_id=str(waiting.workspace_id),
        actor_id=person,
        channel_id=str(waiting.channel_id),
        bot_user_ids=[bot],
    )
    if bot not in allowed:
        return f"{who} may no longer use this agent"
    return None


__all__ = [
    "KIND",
    "MAX_AHEAD",
    "MAX_PER_CHAIN",
    "MIN_AHEAD",
    "ComeBack",
    "no_longer",
    "parse_when",
    "plan",
    "woken",
]
