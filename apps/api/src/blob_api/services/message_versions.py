"""Kept versions (ADR 0039 addendum): a message's earlier words, while it is on hold.

An edit replaces a message's words. While the conversation, or the message's writer, is
on legal hold, the words it replaced are kept here — and only then. Those are the two
holds the writer is shown: a conversation's to everybody in it, a person's to that person.
A custodian who merely sits in the room does not count, because who is a custodian is the
legal team's to say, and a copy its writer could not know about is the surveillance ADR
0039 refuses. Releasing the hold that kept a version removes it; retention removes it with
its message.

A delete under a hold keeps the words it takes the same way (`ended_by = 'delete'`), so
what a held conversation said stays whether its writer edited it away or deleted it.

Readable by an admin who may read the conversation, and in the workspace export, which
holds the public conversations (ADR 0038).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id

#: Held, for keeping a version: the conversation's hold, or its writer's — the two the
#: writer is told about. `c` is the message's channel, `a` its author.
HELD = "(c.legal_hold_at IS NOT NULL OR a.legal_hold_at IS NOT NULL)"


async def keep_before_edit(session: AsyncSession, message_id: str, *, new_body: str) -> bool:
    """Keep the words an edit is about to replace, if the message is on hold. Called in
    the edit's own transaction, before the edit. True when a version was kept."""
    return await _keep(session, message_id, ended_by="edit", new_body=new_body)


async def keep_before_delete(session: AsyncSession, message_id: str) -> bool:
    """Keep the words a delete is about to take, if the message is on hold. Called in the
    delete's own transaction, before the delete empties it."""
    return await _keep(session, message_id, ended_by="delete", new_body="")


async def _keep(session: AsyncSession, message_id: str, *, ended_by: str, new_body: str) -> bool:
    row = (
        await session.execute(
            text(
                f"""
                INSERT INTO message_versions
                  (id, workspace_id, message_id, body, written_at, ended_by)
                SELECT :id, m.workspace_id, m.id, m.body, coalesce(m.edited_at, m.created_at),
                       :ended_by
                  FROM messages m
                  JOIN channels c ON c.id = m.channel_id
                  LEFT JOIN users a ON a.id = m.author_id
                 WHERE m.id = :message AND m.deleted_at IS NULL AND m.body <> :new_body
                   AND {HELD}
                RETURNING id
                """
            ),
            {"id": new_id(), "message": message_id, "new_body": new_body, "ended_by": ended_by},
        )
    ).fetchone()
    return row is not None


async def held(session: AsyncSession, message_id: str) -> bool:
    """Whether an edit of this message now would keep the words it replaces."""
    row = (
        await session.execute(
            text(
                f"""
                SELECT {HELD} AS held FROM messages m
                  JOIN channels c ON c.id = m.channel_id
                  LEFT JOIN users a ON a.id = m.author_id
                 WHERE m.id = :message
                """
            ),
            {"message": message_id},
        )
    ).fetchone()
    return bool(row and row.held)


async def of_message(session: AsyncSession, message_id: str) -> list[Any]:
    """Its kept versions, oldest first."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT body, written_at, replaced_at, ended_by FROM message_versions
                     WHERE message_id = :message ORDER BY id
                    """
                ),
                {"message": message_id},
            )
        ).fetchall()
    )


async def released_conversation(session: AsyncSession, channel_id: str) -> int:
    """A conversation's hold is gone: what it alone kept goes too. A version of a message
    whose writer is still held stays — that hold kept it as well."""
    result = await session.execute(
        text(
            """
            DELETE FROM message_versions v
             USING messages m LEFT JOIN users a ON a.id = m.author_id
             WHERE v.message_id = m.id AND m.channel_id = :channel
               AND a.legal_hold_at IS NULL
            """
        ),
        {"channel": channel_id},
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def released_person(session: AsyncSession, user_id: str) -> int:
    """A person's hold is gone: the versions of what they wrote go, except in a
    conversation that is itself still held."""
    result = await session.execute(
        text(
            """
            DELETE FROM message_versions v
             USING messages m JOIN channels c ON c.id = m.channel_id
             WHERE v.message_id = m.id AND m.author_id = :user
               AND c.legal_hold_at IS NULL
            """
        ),
        {"user": user_id},
    )
    return int(getattr(result, "rowcount", 0) or 0)
