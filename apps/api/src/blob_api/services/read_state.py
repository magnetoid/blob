"""Unread tracking.

A single row per (user, channel) holding a cursor and a mention counter. Because message
ids are UUIDv7, "has unread" is a comparison rather than a COUNT — the difference between
an index probe and a scan, and the reason Discord rebuilt this subsystem separately from
message storage.

The cursor only ever moves forward (GREATEST), so acks arriving out of order from two
devices can't rewind someone's unread line.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..realtime import hub
from ..schemas.models import ReadStateOut


async def mark_read(
    session: AsyncSession, user_id: str, channel_id: str, last_read_message_id: str
) -> ReadStateOut:
    row = (
        await session.execute(
            text(
                """
                INSERT INTO read_states
                  (user_id, channel_id, last_read_message_id, mention_count, updated_at)
                VALUES (:user_id, :channel_id, :message_id, 0, now())
                ON CONFLICT (user_id, channel_id) DO UPDATE
                  SET last_read_message_id = GREATEST(
                        read_states.last_read_message_id, EXCLUDED.last_read_message_id),
                      mention_count = 0,
                      updated_at = now()
                RETURNING last_read_message_id, mention_count
                """
            ),
            {
                "user_id": user_id,
                "channel_id": channel_id,
                "message_id": last_read_message_id,
            },
        )
    ).fetchone()

    return ReadStateOut(
        channel_id=channel_id,
        last_read_message_id=row.last_read_message_id if row else last_read_message_id,
        mention_count=row.mention_count if row else 0,
    )


async def advance_for_author(
    session: AsyncSession, user_id: str, channel_id: str, message_id: str
) -> None:
    """Advance the author's own cursor so their own message never shows as unread."""
    await session.execute(
        text(
            """
            INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at)
            VALUES (:user_id, :channel_id, :message_id, now())
            ON CONFLICT (user_id, channel_id) DO UPDATE
              SET last_read_message_id = GREATEST(
                    read_states.last_read_message_id, EXCLUDED.last_read_message_id),
                  updated_at = now()
            """
        ),
        {"user_id": user_id, "channel_id": channel_id, "message_id": message_id},
    )


async def increment_mentions(
    session: AsyncSession, user_ids: list[str], channel_id: str
) -> list[ReadStateOut]:
    """Called by the notify worker for each recipient a message actually pings."""
    if not user_ids:
        return []

    rows = (
        await session.execute(
            text(
                """
                INSERT INTO read_states (user_id, channel_id, mention_count, updated_at)
                SELECT unnest(cast(:user_ids AS uuid[])), :channel_id, 1, now()
                ON CONFLICT (user_id, channel_id) DO UPDATE
                  SET mention_count = read_states.mention_count + 1,
                      updated_at = now()
                RETURNING user_id, last_read_message_id, mention_count
                """
            ),
            {"user_ids": user_ids, "channel_id": channel_id},
        )
    ).fetchall()

    return [
        ReadStateOut(
            channel_id=channel_id,
            last_read_message_id=row.last_read_message_id,
            mention_count=row.mention_count,
        )
        for row in rows
    ]


def broadcast(user_id: str, state: ReadStateOut) -> None:
    """Other devices belonging to this user need to clear their badge too."""
    hub.to_users([user_id], {"t": "read_state.updated", **state.model_dump(by_alias=True)})


async def list_for_user(session: AsyncSession, user_id: str) -> list[ReadStateOut]:
    rows = (
        await session.execute(
            text(
                """
                SELECT channel_id, last_read_message_id, mention_count
                  FROM read_states WHERE user_id = :user_id
                """
            ),
            {"user_id": user_id},
        )
    ).fetchall()
    return [
        ReadStateOut(
            channel_id=row.channel_id,
            last_read_message_id=row.last_read_message_id,
            mention_count=row.mention_count,
        )
        for row in rows
    ]


async def total_mentions(session: AsyncSession, user_id: str) -> int:
    """Total badge across the workspace — what the tab title and favicon show."""
    row = (
        await session.execute(
            text(
                """
                SELECT COALESCE(sum(mention_count), 0)::int AS total
                  FROM read_states WHERE user_id = :user_id
                """
            ),
            {"user_id": user_id},
        )
    ).fetchone()
    return row.total if row else 0
