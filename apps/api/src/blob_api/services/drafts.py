"""Drafts that follow you (M3 · B3, ADR 0037).

What you typed in a place and have not sent, kept so the next device you open has it.
Yours alone — no route answers another person's drafts, and nothing broadcasts them past
your own sockets. A draft goes when its message is sent (`messages.send` clears it), when
you empty it, when you leave the room, or after thirty days.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: Matches the client's own eviction (`lib/drafts.ts`).
MAX_DRAFTS = 200
KEEP = timedelta(days=30)


def place_of(channel_id: str, thread_root_id: str | None) -> str:
    """The client's `draftKey`, character for character."""
    return f"{channel_id}:{thread_root_id}" if thread_root_id else channel_id


async def list_for(session: AsyncSession, user_id: str) -> list[Any]:
    """Your drafts in rooms you are still in and that still take messages, newest first."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT d.channel_id, d.thread_root_id, d.body, d.updated_at
                      FROM drafts d
                      JOIN channels c ON c.id = d.channel_id AND c.archived_at IS NULL
                      JOIN channel_members cm
                        ON cm.channel_id = d.channel_id AND cm.user_id = d.user_id
                     WHERE d.user_id = :user_id
                     ORDER BY d.updated_at DESC
                     LIMIT :limit
                    """
                ),
                {"user_id": user_id, "limit": MAX_DRAFTS},
            )
        ).fetchall()
    )


async def save(
    session: AsyncSession,
    user_id: str,
    *,
    channel_id: str,
    thread_root_id: str | None,
    body: str,
) -> Any:
    """Keep it, or forget it when it is empty. Returns the row kept, or None."""
    if not body.strip():
        await clear(session, user_id, channel_id=channel_id, thread_root_id=thread_root_id)
        return None
    row = (
        await session.execute(
            text(
                """
                INSERT INTO drafts (user_id, place, channel_id, thread_root_id, body, updated_at)
                VALUES (:user_id, :place, :channel_id, :thread_root_id, :body, now())
                ON CONFLICT (user_id, place)
                  DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at
                RETURNING channel_id, thread_root_id, body, updated_at
                """
            ),
            {
                "user_id": user_id,
                "place": place_of(channel_id, thread_root_id),
                "channel_id": channel_id,
                "thread_root_id": thread_root_id,
                "body": body,
            },
        )
    ).one()
    # The oldest beyond the cap go, so the table cannot grow without end for one person.
    await session.execute(
        text(
            """
            DELETE FROM drafts
             WHERE user_id = :user_id
               AND place NOT IN (SELECT place FROM drafts WHERE user_id = :user_id
                                  ORDER BY updated_at DESC LIMIT :limit)
            """
        ),
        {"user_id": user_id, "limit": MAX_DRAFTS},
    )
    return row


async def clear(
    session: AsyncSession, user_id: str, *, channel_id: str, thread_root_id: str | None
) -> bool:
    """Forget the draft in one place. Whether there was one to forget."""
    result = await session.execute(
        text("DELETE FROM drafts WHERE user_id = :user_id AND place = :place RETURNING place"),
        {"user_id": user_id, "place": place_of(channel_id, thread_root_id)},
    )
    return result.fetchone() is not None


async def sweep(session: AsyncSession, now: datetime | None = None) -> None:
    cutoff = (now or datetime.now(UTC)) - KEEP
    await session.execute(
        text("DELETE FROM drafts WHERE updated_at < cast(:cutoff AS timestamptz)"),
        {"cutoff": cutoff},
    )


def event(
    channel_id: str,
    thread_root_id: str | None,
    body: str,
    updated_at: str,
    *,
    device: str | None = None,
) -> dict[str, Any]:
    """`draft.updated`, to your own sockets: an empty body means it is gone. `device` is
    the tab that saved it, or None when the server did (a message was sent)."""
    return {
        "t": "draft.updated",
        "channelId": channel_id,
        "threadRootId": thread_root_id,
        "body": body,
        "updatedAt": updated_at,
        "device": device,
    }


__all__ = ["KEEP", "MAX_DRAFTS", "clear", "event", "list_for", "place_of", "save", "sweep"]
