"""Messages written now and sent later.

The rule that shapes everything here: a scheduled message is sent through the ordinary
send path, not beside it. Mentions notify, the plugin outbox fills, the socket fans out,
threads update — all of it happens because `messages.send` happens, and a second path
that posted rows directly would be a second place for every one of those to be forgotten.

What this module adds is only *when*.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..schemas.base import require_iso
from ..schemas.models import ScheduledMessage
from . import channels as channel_service
from . import messages as message_service

log = logging.getLogger("blob.scheduled")

#: How far ahead a message may be scheduled. Long enough for "next Monday", short enough
#: that a forgotten row is not a surprise a year later.
MAX_AHEAD_DAYS = 365

#: How near is too near. Under this the author is better served by simply sending it —
#: and the sweep runs once a minute, so anything closer would go out late regardless.
MIN_AHEAD_SECONDS = 30

#: Rows per sweep. The cron runs every minute; a backlog drains over several.
BATCH = 50


def _row_to_model(row: object) -> ScheduledMessage:
    return ScheduledMessage(
        id=str(row.id),  # type: ignore[attr-defined]
        channel_id=str(row.channel_id),  # type: ignore[attr-defined]
        body=row.body,  # type: ignore[attr-defined]
        thread_root_id=(
            str(row.thread_root_id) if row.thread_root_id else None  # type: ignore[attr-defined]
        ),
        send_at=require_iso(row.send_at),  # type: ignore[attr-defined]
        created_at=require_iso(row.created_at),  # type: ignore[attr-defined]
        last_error=row.last_error,  # type: ignore[attr-defined]
    )


async def schedule(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    author_id: str,
    body: str,
    send_at: datetime,
    client_msg_id: str,
    thread_root_id: str | None = None,
) -> ScheduledMessage:
    """Put a message aside to be sent at `send_at`.

    Membership is checked now *and* again at send time. Now, so the author is told
    immediately rather than discovering at nine in the morning that a message they wrote
    at midnight went nowhere; again later, because leaving the channel in between should
    stop it.
    """
    if not body.strip():
        raise bad_request("A scheduled message needs something in it.", code="invalid_input")

    now = datetime.now(UTC)
    ahead = (send_at - now).total_seconds()
    if ahead < MIN_AHEAD_SECONDS:
        raise bad_request(
            "That time has passed, or is too close to schedule — send it instead.",
            code="invalid_input",
        )
    if ahead > MAX_AHEAD_DAYS * 86400:
        raise bad_request(
            f"Scheduling reaches {MAX_AHEAD_DAYS} days ahead, no further.",
            code="invalid_input",
        )

    await channel_service.assert_channel_access(
        session, author_id, channel_id, require_member=True
    )

    row = (
        await session.execute(
            text(
                """
                INSERT INTO scheduled_messages
                  (id, workspace_id, channel_id, author_id, body, thread_root_id,
                   client_msg_id, send_at)
                VALUES (:id, :ws, :channel, :author, :body, :root, :client_msg_id, :send_at)
                RETURNING id, channel_id, body, thread_root_id, send_at, created_at,
                          last_error
                """
            ),
            {
                "id": new_id(),
                "ws": workspace_id,
                "channel": channel_id,
                "author": author_id,
                "body": body,
                "root": thread_root_id,
                "client_msg_id": client_msg_id,
                "send_at": send_at,
            },
        )
    ).fetchone()
    assert row is not None
    return _row_to_model(row)


async def list_for_author(session: AsyncSession, author_id: str) -> list[ScheduledMessage]:
    """What this person has waiting, soonest first. Sent and cancelled rows are history."""
    rows = (
        await session.execute(
            text(
                """
                SELECT id, channel_id, body, thread_root_id, send_at, created_at, last_error
                  FROM scheduled_messages
                 WHERE author_id = :author
                   AND sent_at IS NULL AND canceled_at IS NULL
                 ORDER BY send_at
                 LIMIT 200
                """
            ),
            {"author": author_id},
        )
    ).fetchall()
    return [_row_to_model(row) for row in rows]


async def cancel(session: AsyncSession, author_id: str, scheduled_id: str) -> None:
    """Take it back. Only the author's own, and only while it is still waiting."""
    row = (
        await session.execute(
            text(
                """
                UPDATE scheduled_messages
                   SET canceled_at = now()
                 WHERE id = :id AND author_id = :author
                   AND sent_at IS NULL AND canceled_at IS NULL
                RETURNING id
                """
            ),
            {"id": scheduled_id, "author": author_id},
        )
    ).fetchone()
    if row is None:
        # Gone, someone else's, or already sent — all the same answer, because which one
        # it is would say something about another person's schedule.
        raise not_found("That scheduled message is gone.")


async def due_batch(session: AsyncSession) -> list[dict[str, object]]:
    """Claim the messages that are due. `SKIP LOCKED`, so two workers cannot both send one."""
    rows = (
        await session.execute(
            text(
                """
                SELECT s.id, s.workspace_id, s.channel_id, s.author_id, s.body,
                       s.thread_root_id, s.client_msg_id
                  FROM scheduled_messages s
                 WHERE s.send_at <= now()
                   AND s.sent_at IS NULL AND s.canceled_at IS NULL
                 ORDER BY s.send_at
                 FOR UPDATE OF s SKIP LOCKED
                 LIMIT :batch
                """
            ),
            {"batch": BATCH},
        )
    ).fetchall()
    return [
        {
            "id": str(row.id),
            "workspace_id": str(row.workspace_id),
            "channel_id": str(row.channel_id),
            "author_id": str(row.author_id),
            "body": row.body,
            "thread_root_id": str(row.thread_root_id) if row.thread_root_id else None,
            "client_msg_id": row.client_msg_id,
        }
        for row in rows
    ]


async def deliver(session: AsyncSession, item: dict[str, object]) -> message_service.SendResult:
    """Send one due message, through the path every other message takes."""
    # Re-checked here rather than trusted from scheduling time: leaving the channel in
    # between should stop the message, and an author who was removed should not still be
    # able to post through a row they left behind.
    await channel_service.assert_channel_access(
        session, str(item["author_id"]), str(item["channel_id"]), require_member=True
    )
    return await message_service.send(
        session,
        workspace_id=str(item["workspace_id"]),
        channel_id=str(item["channel_id"]),
        author_id=str(item["author_id"]),
        body=str(item["body"]),
        # The same id it was scheduled with: a sweep that fails after sending and retries
        # finds the message already stored rather than posting it twice.
        client_msg_id=str(item["client_msg_id"]),
        thread_root_id=(
            str(item["thread_root_id"]) if item["thread_root_id"] is not None else None
        ),
    )


async def mark_sent(session: AsyncSession, scheduled_id: str, message_id: str) -> None:
    await session.execute(
        text(
            "UPDATE scheduled_messages SET sent_at = now(), sent_message_id = :message_id"
            " WHERE id = :id"
        ),
        {"id": scheduled_id, "message_id": message_id},
    )


async def mark_failed(session: AsyncSession, scheduled_id: str, reason: str) -> None:
    """Record why, and stand down.

    Not retried: the reasons a scheduled send fails are mostly permanent by the time it
    fires — the channel is gone, the author left it, the workspace archived it. Retrying
    a message into a channel somebody has left, once a minute, forever, is worse than
    telling them it did not go.
    """
    await session.execute(
        text(
            "UPDATE scheduled_messages SET canceled_at = now(), last_error = :reason"
            " WHERE id = :id"
        ),
        {"id": scheduled_id, "reason": reason[:500]},
    )
