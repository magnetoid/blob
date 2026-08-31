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


async def mark_all_read(session: AsyncSession, user_id: str) -> list[ReadStateOut]:
    """Move every membership's cursor to the newest message in its channel.

    One statement rather than a loop over channels: the set of channels is exactly the
    set of memberships, the newest id per channel is a grouped max over an index that
    already exists, and doing it per channel would be one round trip per row for the
    person most likely to have hundreds of them.

    The workspace boundary rides in on `channel_members` — a membership only exists for
    a channel in the member's own workspace — so it is inside the statement rather than
    checked beside it. The GREATEST is what makes it safe to run twice, and safe against
    a stale ack racing it from another tab.

    Returns only the rows that actually moved, because those are the ones worth
    broadcasting; a channel that was already read has nothing to tell the other tabs.
    """
    rows = (
        await session.execute(
            text(
                """
                WITH newest AS (
                    -- DISTINCT ON rather than MAX(id): uuid has no max aggregate, and
                    -- this walks the (channel_id, id) index backwards one row per
                    -- channel instead of aggregating the table.
                    SELECT DISTINCT ON (m.channel_id) m.channel_id, m.id AS message_id
                      FROM messages m
                      JOIN channel_members cm
                        ON cm.channel_id = m.channel_id AND cm.user_id = :user_id
                     WHERE m.deleted_at IS NULL
                     ORDER BY m.channel_id, m.id DESC
                )
                INSERT INTO read_states
                  (user_id, channel_id, last_read_message_id, mention_count, updated_at)
                SELECT :user_id, newest.channel_id, newest.message_id, 0, now()
                  FROM newest
                ON CONFLICT (user_id, channel_id) DO UPDATE
                  SET last_read_message_id = GREATEST(
                        read_states.last_read_message_id, EXCLUDED.last_read_message_id),
                      mention_count = 0,
                      updated_at = now()
                WHERE read_states.last_read_message_id IS DISTINCT FROM
                        EXCLUDED.last_read_message_id
                   OR read_states.mention_count <> 0
                RETURNING channel_id, last_read_message_id, mention_count
                """
            ),
            {"user_id": user_id},
        )
    ).fetchall()

    return [
        ReadStateOut(
            channel_id=str(row.channel_id),
            last_read_message_id=str(row.last_read_message_id),
            mention_count=row.mention_count,
        )
        for row in rows
    ]


async def mark_unread(
    session: AsyncSession, user_id: str, channel_id: str, message_id: str
) -> ReadStateOut:
    """Leave this message, and everything after it, unread.

    A separate verb from `mark_read` on purpose. That one is a ratchet — `GREATEST(...)`,
    so the cursor only ever moves forward — and the ratchet is load-bearing: two tabs
    both call it on focus, and a stale one arriving second would otherwise un-read what
    the other had just read. Rewinding has to be something a person asked for, not
    something a race can do.

    The cursor lands on the message *before* the target, so the target itself is the
    first unread one — which is what "mark unread" means when you are marking the message
    you want to come back to.
    """
    previous = (
        await session.execute(
            text(
                """
                SELECT id FROM messages
                 WHERE channel_id = :channel_id
                   AND thread_root_id IS NULL
                   AND deleted_at IS NULL
                   AND id < :message_id
                 ORDER BY id DESC
                 LIMIT 1
                """
            ),
            {"channel_id": channel_id, "message_id": message_id},
        )
    ).fetchone()
    cursor = previous.id if previous else None

    # Recomputed rather than left at zero. `mark_read` zeroes the badge, so rewinding past
    # a message that named you would otherwise leave it silently uncounted — the channel
    # would show unread without saying it wants you specifically.
    mentions = (
        await session.execute(
            text(
                """
                SELECT count(*)::int AS count FROM messages m
                 WHERE m.channel_id = :channel_id
                   AND m.deleted_at IS NULL
                   AND m.author_id IS DISTINCT FROM cast(:user_id AS uuid)
                   AND (cast(:cursor AS uuid) IS NULL OR m.id > cast(:cursor AS uuid))
                   AND (
                     cast(:user_id AS uuid) = ANY(m.mention_user_ids)
                     OR m.mentions_everyone
                     OR m.mention_group_ids && (
                          SELECT coalesce(array_agg(group_id), '{}')
                            FROM user_group_members WHERE user_id = :user_id)
                   )
                """
            ),
            {"channel_id": channel_id, "user_id": user_id, "cursor": cursor},
        )
    ).fetchone()
    mention_count = mentions.count if mentions else 0

    await session.execute(
        text(
            """
            INSERT INTO read_states
              (user_id, channel_id, last_read_message_id, mention_count, updated_at)
            VALUES (:user_id, :channel_id, cast(:cursor AS uuid), :mention_count, now())
            ON CONFLICT (user_id, channel_id) DO UPDATE
              SET last_read_message_id = cast(:cursor AS uuid),
                  mention_count = :mention_count,
                  updated_at = now()
            """
        ),
        {
            "user_id": user_id,
            "channel_id": channel_id,
            "cursor": cursor,
            "mention_count": mention_count,
        },
    )
    return ReadStateOut(
        channel_id=channel_id, last_read_message_id=cursor, mention_count=mention_count
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
