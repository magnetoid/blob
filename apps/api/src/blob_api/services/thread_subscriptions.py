"""Following threads, and how far into each one a person has read.

Replying subscribes you (that write is in `messages.send`, with the reply); everything
else about the subscription — listing, following on purpose, stopping, and the read
cursor — is here. "Unread" is a string comparison, the same trick the channel list
uses: ids are UUIDv7, so the newest reply's id sorts above every reply already seen.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message


async def threads_for_user(
    session: AsyncSession, user_id: str, limit: int = 30
) -> tuple[list[Message], list[str]]:
    """Threads you follow, most recently active first, and which of them have new replies.

    "Unread" is a string comparison, the same trick the channel list uses: ids are UUIDv7,
    so the newest reply's id sorts above every reply you have already seen. No counting,
    no timestamp join.

    `last_read_reply_id` has been written since threads shipped — set to your own reply
    each time you posted one — and read by nothing, so a thread you had replied in looked
    identical to one you had read to the end.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT},
                       (SELECT r.id FROM messages r
                         WHERE r.thread_root_id = m.id AND r.deleted_at IS NULL
                         ORDER BY r.id DESC LIMIT 1) AS newest_reply_id,
                       ts.last_read_reply_id AS seen_reply_id
                  FROM messages m
                  JOIN thread_subscriptions ts
                    ON ts.thread_root_id = m.id AND ts.user_id = :user_id
                 WHERE m.deleted_at IS NULL AND ts.muted = false
                 ORDER BY m.last_reply_at DESC NULLS LAST
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()

    unread = [
        row.id
        for row in rows
        if row.newest_reply_id is not None
        and (row.seen_reply_id is None or str(row.newest_reply_id) > str(row.seen_reply_id))
    ]
    return [to_message(row) for row in rows], unread


async def following(session: AsyncSession, user_id: str, root_id: str) -> bool:
    """Whether this person is following that thread."""
    row = (
        await session.execute(
            text(
                """
                SELECT muted FROM thread_subscriptions
                 WHERE user_id = :user_id AND thread_root_id = :root_id
                """
            ),
            {"user_id": user_id, "root_id": root_id},
        )
    ).fetchone()
    return row is not None and not row.muted


async def set_following(session: AsyncSession, user_id: str, root_id: str, following: bool) -> None:
    """Follow a thread, or stop.

    The row is kept either way rather than deleted, because it carries how far you had
    read — unfollowing and following again should not present a thread you have read as
    new. `muted` has existed on this table since the beginning and nothing ever wrote it,
    so once you had replied you were subscribed for good with no control anywhere.

    Following one you have never replied in starts you at the end, not the beginning: you
    asked to hear what happens next, not to be handed everything already said.
    """
    await session.execute(
        text(
            """
            INSERT INTO thread_subscriptions (user_id, thread_root_id, last_read_reply_id, muted)
            VALUES (
                :user_id, :root_id,
                (SELECT r.id FROM messages r
                  WHERE r.thread_root_id = :root_id AND r.deleted_at IS NULL
                  ORDER BY r.id DESC LIMIT 1),
                :muted
            )
            ON CONFLICT (user_id, thread_root_id) DO UPDATE SET muted = EXCLUDED.muted
            """
        ),
        {"user_id": user_id, "root_id": root_id, "muted": not following},
    )


async def mark_read(session: AsyncSession, user_id: str, root_id: str) -> None:
    """Move the thread's read cursor to its newest reply.

    Only for somebody already following it — opening a thread to look is not a request to
    be told about it forever, which is why reading does not subscribe you. Forward-only,
    like the channel cursor: `GREATEST` so a slow tab cannot drag it backwards.
    """
    await session.execute(
        text(
            """
            UPDATE thread_subscriptions ts
               SET last_read_reply_id = GREATEST(
                     ts.last_read_reply_id,
                     (SELECT r.id FROM messages r
                       WHERE r.thread_root_id = :root_id AND r.deleted_at IS NULL
                       ORDER BY r.id DESC LIMIT 1)
                   )
             WHERE ts.user_id = :user_id AND ts.thread_root_id = :root_id
            """
        ),
        {"user_id": user_id, "root_id": root_id},
    )
