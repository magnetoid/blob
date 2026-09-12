"""Reactions: one row per (message, person, emoji), and the activity it counts as."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def add(session: AsyncSession, message_id: str, user_id: str, emoji: str) -> bool:
    rows = (
        await session.execute(
            text(
                """
                INSERT INTO reactions (message_id, user_id, emoji)
                VALUES (:message_id, :user_id, :emoji)
                ON CONFLICT DO NOTHING RETURNING message_id
                """
            ),
            {"message_id": message_id, "user_id": user_id, "emoji": emoji},
        )
    ).fetchall()
    if not rows:
        return False
    from . import activity as activity_service

    await activity_service.record_reaction(
        session, message_id=message_id, actor_id=user_id, emoji=emoji
    )
    return True


async def remove(session: AsyncSession, message_id: str, user_id: str, emoji: str) -> bool:
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM reactions
                 WHERE message_id = :message_id AND user_id = :user_id AND emoji = :emoji
                RETURNING message_id
                """
            ),
            {"message_id": message_id, "user_id": user_id, "emoji": emoji},
        )
    ).fetchall()
    return len(rows) > 0
