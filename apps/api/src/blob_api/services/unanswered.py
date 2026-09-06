"""Questions nobody answered, and the one quiet nudge each of them gets. ADR 0015.

A question that nobody answers is the message in a channel that most needs a second
look and the one least likely to get it: it has scrolled away, and the person who asked
is the only one still holding it. Gmail's inline "Sent 3 days ago. Follow up?" is the
idiom people know; Slack has nothing beyond "remind me about this".

Three decisions shape this module. **Who is told**: the asker, and only the asker. Telling
the room "nobody answered X" is a public statement about everyone else's attention — a
read receipt in a different coat — and Blob does not do read receipts. Telling the asker
"no answer yet" is derivable from what they can already see. **What "answered" means**: a
reply in the thread, a reaction from somebody else, a later message in the channel by
somebody else within the window, or a later message that mentions the asker. All of it is
public data; none of it is who *saw* the question. A later message from an app does not
count as somebody chiming in, or a channel with hourly CI notices would never nudge.
**How the nudge arrives**: as a
reminder on the message in Later, armed to fire now. That rides `jobs/reminders.py`
end to end — quiet hours defer it, it pushes if push is set up, it shows in Later until
dealt with — and adds no protocol surface. A channel opts in (`channels.nudge_unanswered`,
off by default, because the room's conversation is the room's to govern) and a person
can opt out of being nudged at all (`prefs.nudges`).

Detection is a sweep every quarter hour that is proportional to the channels opted in,
not to the messages in the workspace: it starts from those channels and bounds the scan
by UUIDv7 id range, which is the `(channel_id, id DESC)` index doing the work. A question
that slips past the window without being nudged is left alone — a stale proactive message
is worse than none, the same stance `jobs/scheduled.py` takes on missed slots.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import uuid_utils
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .serialize import read_prefs

#: How long a question goes unanswered before its asker is nudged. A working day: long
#: enough that "nobody has replied yet" is a fact rather than an impatience.
UNANSWERED_AFTER_HOURS = 24

#: How far past the threshold the sweep still looks. Two hours covers a worker that
#: missed a few ticks; a question older than that is not nudged at all.
LOOKBACK_HOURS = 2

BATCH = 50

#: How much of the question the reminder quotes.
EXCERPT_CHARS = 80


@dataclass(slots=True)
class Question:
    id: str
    workspace_id: str
    channel_id: str
    channel_name: str | None
    user_id: str
    body: str
    #: The asker's notification level for the channel; `none` means they muted it.
    notify_level: str
    #: The asker's own switch for being nudged at all.
    wants_nudges: bool


def _time_id(moment: datetime) -> str:
    """A UUIDv7 whose time bits are `moment`, for bounding an id range by time."""
    return str(uuid_utils.uuid7(timestamp=int(moment.timestamp()), nanos=0))


def excerpt(body: str) -> str:
    flat = re.sub(r"\s+", " ", body.strip())
    if len(flat) <= EXCERPT_CHARS:
        return flat
    return flat[: EXCERPT_CHARS - 1].rstrip() + "…"


def note_for(question: Question) -> str:
    where = f"#{question.channel_name}" if question.channel_name else "the channel"
    return f"No answer yet in {where}: “{excerpt(question.body)}”"


def wants(question: Question) -> bool:
    """Whether this asker should be nudged at all. Muting the channel is an answer too."""
    return question.wants_nudges and question.notify_level != "none"


async def candidates(
    session: AsyncSession,
    *,
    now: datetime,
    hours: int = UNANSWERED_AFTER_HOURS,
    batch: int = BATCH,
) -> list[Question]:
    """Questions that have gone `hours` unanswered in an opted-in channel, oldest first.

    "Unanswered" is spelled out in the statement so it is one definition: no live reply in
    the thread, no reaction from anybody else, no later message in the channel by another
    *person* (an app posting its hourly notice is not somebody chiming in), and no later
    message anywhere in the channel — thread replies included — that mentions the asker.
    Somebody who muted the channel or switched nudges off is excluded here too, so their
    questions never occupy the batch. The id bounds are coarse (a minute of slack for
    UUIDv7's random low bits) and pick the index; the `created_at` pair is the exact
    window. Membership and the workspace boundary are inside the statement, and so is
    the ratchet.
    """
    asked_before = now - timedelta(hours=hours)
    forget_before = asked_before - timedelta(hours=LOOKBACK_HOURS)
    rows = (
        await session.execute(
            text(
                """
                SELECT m.id, m.workspace_id, m.channel_id, m.author_id, m.body,
                       c.name AS channel_name, cm.notify_level, u.prefs
                  FROM channels c
                  JOIN messages m ON m.channel_id = c.id
                  JOIN users u ON u.id = m.author_id AND u.workspace_id = c.workspace_id
                  JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = m.author_id
                 WHERE c.nudge_unanswered
                   AND c.archived_at IS NULL
                   AND c.kind IN ('public', 'private')
                   AND m.id >= cast(:floor_id AS uuid)
                   AND m.id <  cast(:ceiling_id AS uuid)
                   AND m.created_at <= :asked_before
                   AND m.created_at >  :forget_before
                   AND m.thread_root_id IS NULL
                   AND m.deleted_at IS NULL
                   AND m.kind = 'user'
                   AND u.kind = 'human'
                   AND u.deactivated_at IS NULL
                   AND m.body ~ '[?\uff1f][]"''!.)*_[:space:]]*$'
                   AND m.reply_count = 0
                   AND cm.notify_level <> 'none'
                   AND COALESCE((u.prefs ->> 'nudges')::boolean, true)
                   AND NOT EXISTS (SELECT 1 FROM messages r
                                    WHERE r.thread_root_id = m.id AND r.deleted_at IS NULL)
                   AND NOT EXISTS (SELECT 1 FROM reactions x
                                    WHERE x.message_id = m.id AND x.user_id <> m.author_id)
                   AND NOT EXISTS (SELECT 1 FROM messages later
                                    WHERE later.channel_id = m.channel_id
                                      AND later.id > m.id
                                      AND later.deleted_at IS NULL
                                      AND later.kind <> 'system'
                                      AND later.author_id IS DISTINCT FROM m.author_id
                                      AND (m.author_id = ANY(later.mention_user_ids)
                                           OR ((later.thread_root_id IS NULL
                                                OR later.also_in_channel)
                                               AND EXISTS (SELECT 1 FROM users lu
                                                            WHERE lu.id = later.author_id
                                                              AND lu.kind = 'human'))))
                   AND NOT EXISTS (SELECT 1 FROM unanswered_nudges n WHERE n.message_id = m.id)
                 ORDER BY m.id
                 LIMIT :batch
                """
            ),
            {
                "floor_id": _time_id(forget_before - timedelta(minutes=1)),
                "ceiling_id": _time_id(asked_before + timedelta(minutes=1)),
                "asked_before": asked_before,
                "forget_before": forget_before,
                "batch": batch,
            },
        )
    ).fetchall()
    out: list[Question] = []
    for row in rows:
        prefs = read_prefs(row.prefs)
        out.append(
            Question(
                id=str(row.id),
                workspace_id=str(row.workspace_id),
                channel_id=str(row.channel_id),
                channel_name=row.channel_name,
                user_id=str(row.author_id),
                body=row.body,
                notify_level=row.notify_level or "mentions",
                wants_nudges=prefs.nudges,
            )
        )
    return out


async def claim(session: AsyncSession, question: Question) -> bool:
    """Take the question for this worker. False means another sweep already has it."""
    row = (
        await session.execute(
            text(
                """
                INSERT INTO unanswered_nudges (message_id, workspace_id, channel_id, user_id)
                VALUES (:message_id, :workspace_id, :channel_id, :user_id)
                ON CONFLICT (message_id) DO NOTHING
                RETURNING message_id
                """
            ),
            {
                "message_id": question.id,
                "workspace_id": question.workspace_id,
                "channel_id": question.channel_id,
                "user_id": question.user_id,
            },
        )
    ).fetchone()
    return row is not None


async def nudge(session: AsyncSession, question: Question) -> None:
    """Arm a reminder on the question for its asker, due now.

    If they already put the message in Later, theirs wins: a reminder they set keeps its
    time and their note stays. One they have marked done or archived is not resurfaced.
    `jobs/reminders.py` does the rest — quiet hours, the toast, push, the Later badge.
    """
    await session.execute(
        text(
            """
            INSERT INTO saved_items (user_id, message_id, remind_at, note)
            VALUES (:user_id, :message_id, now(), :note)
            ON CONFLICT (user_id, message_id) DO UPDATE
               SET remind_at = COALESCE(saved_items.remind_at, now()),
                   note = COALESCE(saved_items.note, EXCLUDED.note)
             WHERE saved_items.state = 'in_progress' AND saved_items.reminded_at IS NULL
            """
        ),
        {"user_id": question.user_id, "message_id": question.id, "note": note_for(question)},
    )


async def nudged_for(session: AsyncSession, message_id: str) -> Any | None:
    row = (
        await session.execute(
            text("SELECT * FROM unanswered_nudges WHERE message_id = :id"), {"id": message_id}
        )
    ).fetchone()
    return row


__all__ = [
    "BATCH",
    "LOOKBACK_HOURS",
    "UNANSWERED_AFTER_HOURS",
    "Question",
    "candidates",
    "claim",
    "excerpt",
    "note_for",
    "nudge",
    "nudged_for",
    "wants",
]
