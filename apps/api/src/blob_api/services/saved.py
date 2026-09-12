"""Pins, saved messages and Later.

Pins belong to the channel — everyone in it sees them. Saved items and Later belong to
one person, and the join against `channel_members` in every listing is the security
boundary, the same one search uses: leaving a channel takes its messages out of your
list, and a row in `saved_items` is not permission.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import message_gone
from ..schemas.base import require_iso
from ..schemas.models import Message
from . import messages as message_service
from .serialize import MESSAGE_SELECT, to_message

_UNSET: Any = object()


async def set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool) -> Message:
    await session.execute(
        text(
            """
            UPDATE messages
               SET pinned_at = CASE WHEN :pinned THEN now() ELSE NULL END,
                   pinned_by = CASE WHEN :pinned THEN cast(:user_id AS uuid) ELSE NULL END
             WHERE id = :id AND deleted_at IS NULL
            """
        ),
        {"id": message_id, "pinned": pinned, "user_id": user_id},
    )
    message = await message_service.by_id(session, message_id)
    if message is None:
        raise message_gone()
    return message


async def list_pinned(session: AsyncSession, channel_id: str) -> list[Message]:
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                 WHERE m.channel_id = :channel_id
                   AND m.pinned_at IS NOT NULL
                   AND m.deleted_at IS NULL
                 ORDER BY m.pinned_at DESC
                 LIMIT 200
                """
            ),
            {"channel_id": channel_id},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool) -> None:
    """Put a message aside, or take it back off the list.

    Idempotent in both directions by construction: the primary key is the pair, so a
    second save conflicts into nothing and a second unsave deletes nothing. Neither
    needs a read first, which is what keeps two taps on a phone from racing.
    """
    if saved:
        await session.execute(
            text(
                """
                INSERT INTO saved_items (user_id, message_id)
                VALUES (cast(:user_id AS uuid), cast(:message_id AS uuid))
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "message_id": message_id},
        )
    else:
        await session.execute(
            text(
                """
                DELETE FROM saved_items
                 WHERE user_id = cast(:user_id AS uuid)
                   AND message_id = cast(:message_id AS uuid)
                """
            ),
            {"user_id": user_id, "message_id": message_id},
        )


async def set_later(
    session: AsyncSession,
    message_id: str,
    user_id: str,
    *,
    state: str | None = None,
    remind_at: Any | None = _UNSET,
    note: Any = _UNSET,
) -> None:
    """Update a saved item's Later fields, saving it first if it wasn't.

    Upsert on purpose: "remind me about this" from a message's menu is one gesture,
    and requiring a separate save first would make the common path two. Setting a new
    reminder re-arms `reminded_at`, so "again in an hour" works on a fired one.
    """
    await session.execute(
        text(
            """
            INSERT INTO saved_items (user_id, message_id)
            VALUES (cast(:user_id AS uuid), cast(:message_id AS uuid))
            ON CONFLICT DO NOTHING
            """
        ),
        {"user_id": user_id, "message_id": message_id},
    )
    await session.execute(
        text(
            """
            UPDATE saved_items
               SET state = COALESCE(:state, state),
                   remind_at = CASE WHEN :has_remind THEN cast(:remind_at AS timestamptz)
                                    ELSE remind_at END,
                   reminded_at = CASE WHEN :has_remind THEN NULL ELSE reminded_at END,
                   note = CASE WHEN :has_note THEN :note ELSE note END
             WHERE user_id = cast(:user_id AS uuid)
               AND message_id = cast(:message_id AS uuid)
            """
        ),
        {
            "user_id": user_id,
            "message_id": message_id,
            "state": state,
            "has_remind": remind_at is not _UNSET,
            "remind_at": None if remind_at is _UNSET else remind_at,
            "has_note": note is not _UNSET,
            "note": None if note is _UNSET else note,
        },
    )


async def list_later(
    session: AsyncSession, user_id: str, *, state: str = "in_progress", limit: int = 100
) -> list[dict[str, Any]]:
    """The Later view: saved messages in one state, with their reminder metadata.

    Same security join as `list_saved` — leaving a channel takes its messages out of
    your list, and a saved row is not permission.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT},
                       s.state AS later_state, s.remind_at, s.note, s.reminded_at
                  FROM messages m
                  JOIN saved_items s
                    ON s.message_id = m.id AND s.user_id = :user_id
                  JOIN channel_members cm
                    ON cm.channel_id = m.channel_id
                   AND cm.user_id = :user_id          -- the security boundary
                 WHERE m.deleted_at IS NULL AND s.state = :state
                 ORDER BY s.created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "state": state, "limit": limit},
        )
    ).fetchall()
    return [
        {
            "message": to_message(row),
            "state": row.later_state,
            "remindAt": require_iso(row.remind_at) if row.remind_at else None,
            "remindedAt": require_iso(row.reminded_at) if row.reminded_at else None,
            "note": row.note,
        }
        for row in rows
    ]


async def list_saved(session: AsyncSession, user_id: str, limit: int = 100) -> list[Message]:
    """Somebody's saved messages, newest save first.

    The join against `channel_members` is the security boundary and is exactly the one
    `search` uses, for the same reason and with the same consequence: leaving a channel
    takes its messages out of your list. Saving cannot be a way to keep reading a
    conversation you were removed from, and a row in this table is not permission.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                  JOIN saved_items s
                    ON s.message_id = m.id AND s.user_id = :user_id
                  JOIN channel_members cm
                    ON cm.channel_id = m.channel_id
                   AND cm.user_id = :user_id          -- the security boundary
                 WHERE m.deleted_at IS NULL
                 ORDER BY s.created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def saved_message_ids(session: AsyncSession, user_id: str, limit: int = 500) -> list[str]:
    """Just the ids, for the boot payload.

    The client needs these to label one menu item — "Save for later" against "Remove
    from later" — and putting a per-user flag on `Message` itself would mean threading a
    user id through `MESSAGE_SELECT`, which is also what every broadcast is built from
    and has no single reader. Per-user state belongs with the other per-user state.

    Deliberately not access-filtered: an id is not content, this runs on every boot, and
    the list that renders them is. A stale id costs one wrong menu label until the next
    boot, which is the correct amount of machinery for the problem.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT message_id FROM saved_items
                 WHERE user_id = :user_id
                 ORDER BY created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()
    return [str(row.message_id) for row in rows]
