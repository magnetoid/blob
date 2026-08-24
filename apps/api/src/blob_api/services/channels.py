"""Channel membership and access.

`assert_channel_access` is the single authorization path for anything channel-scoped.
One helper means one place to audit and one place to test.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import conflict, forbidden, not_found, unique_violation
from ..lib.ids import new_id
from ..schemas.models import ChannelWithState
from .serialize import to_channel_with_state

#: Channels every new member joins automatically.
DEFAULT_CHANNELS = ("general", "random")

CHANNEL_STATE_SELECT = """
  SELECT c.id, c.kind, c.name, c.topic, c.description, c.created_by,
         c.archived_at, c.last_message_id, c.created_at,
         cm.notify_level, cm.is_starred, cm.joined_at,
         rs.last_read_message_id, rs.mention_count,
         CASE WHEN c.kind IN ('dm', 'group_dm')
              THEN (SELECT array_agg(m2.user_id) FROM channel_members m2
                     WHERE m2.channel_id = c.id)
              ELSE NULL END AS member_ids
    FROM channels c
    LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = :user_id
    LEFT JOIN read_states  rs ON rs.channel_id = c.id AND rs.user_id = :user_id
"""


async def list_for_user(
    session: AsyncSession, user_id: str, workspace_id: str
) -> list[ChannelWithState]:
    """Channels the user belongs to, plus public channels they could join."""
    rows = (
        await session.execute(
            text(
                CHANNEL_STATE_SELECT
                + """
                 WHERE c.workspace_id = :workspace_id
                   AND (cm.user_id IS NOT NULL
                        OR (c.kind = 'public' AND c.archived_at IS NULL))
                 ORDER BY c.kind, lower(c.name) NULLS LAST, c.created_at
                """
            ),
            {"user_id": user_id, "workspace_id": workspace_id},
        )
    ).fetchall()
    return [to_channel_with_state(row) for row in rows]


async def get_for_user(
    session: AsyncSession, channel_id: str, user_id: str
) -> ChannelWithState | None:
    row = (
        await session.execute(
            text(CHANNEL_STATE_SELECT + " WHERE c.id = :channel_id"),
            {"user_id": user_id, "channel_id": channel_id},
        )
    ).fetchone()
    return to_channel_with_state(row) if row else None


@dataclass(slots=True)
class ChannelAccess:
    channel_id: str
    kind: Literal["public", "private", "dm", "group_dm"]
    workspace_id: str
    is_member: bool
    archived: bool


async def assert_channel_access(
    session: AsyncSession,
    user_id: str,
    channel_id: str,
    *,
    require_member: bool = False,
    require_writable: bool = False,
) -> ChannelAccess:
    """Authorize a user against a channel.

    Private channels and DMs report 404 rather than 403 to non-members — their very
    existence is private.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT c.id, c.kind, c.workspace_id, c.archived_at, cm.user_id AS member
                  FROM channels c
                  -- Scoped by the caller's own workspace, and joined rather than passed
                  -- in so that no call site can forget it. Without this a channel is
                  -- found by id alone, and `is_public` then grants a read to anyone on
                  -- the server — including someone whose account is in another
                  -- workspace entirely. Unreachable while a server held one workspace;
                  -- a cross-tenant read the moment it held two.
                  JOIN users u ON u.id = :user_id AND u.workspace_id = c.workspace_id
                  LEFT JOIN channel_members cm
                         ON cm.channel_id = c.id AND cm.user_id = :user_id
                 WHERE c.id = :channel_id
                """
            ),
            {"user_id": user_id, "channel_id": channel_id},
        )
    ).fetchone()

    if row is None:
        raise not_found("That channel no longer exists.")

    is_member = row.member is not None
    is_public = row.kind == "public"

    if not is_member and not is_public:
        raise not_found("That channel no longer exists.")
    if not is_member and require_member:
        raise forbidden("Join the channel first.")
    if require_writable and row.archived_at is not None:
        raise forbidden("This channel is archived and read-only.")

    return ChannelAccess(
        channel_id=row.id,
        kind=row.kind,
        workspace_id=row.workspace_id,
        is_member=is_member,
        archived=row.archived_at is not None,
    )


async def member_ids(session: AsyncSession, channel_id: str) -> list[str]:
    rows = (
        await session.execute(
            text("SELECT user_id FROM channel_members WHERE channel_id = :channel_id"),
            {"channel_id": channel_id},
        )
    ).fetchall()
    return [row.user_id for row in rows]


async def add_members(session: AsyncSession, channel_id: str, user_ids: list[str]) -> None:
    if not user_ids:
        return
    await session.execute(
        text(
            """
            INSERT INTO channel_members (channel_id, user_id)
            SELECT :channel_id, unnest(cast(:user_ids AS uuid[]))
            ON CONFLICT DO NOTHING
            """
        ),
        {"channel_id": channel_id, "user_ids": user_ids},
    )
    # A fresh member starts with a clean slate rather than every message unread.
    await session.execute(
        text(
            """
            INSERT INTO read_states (user_id, channel_id, last_read_message_id)
            SELECT unnest(cast(:user_ids AS uuid[])), :channel_id,
                   (SELECT last_message_id FROM channels WHERE id = :channel_id)
            ON CONFLICT DO NOTHING
            """
        ),
        {"channel_id": channel_id, "user_ids": user_ids},
    )


async def create_channel(
    session: AsyncSession,
    *,
    workspace_id: str,
    created_by: str,
    name: str,
    kind: str,
    topic: str | None = None,
    description: str | None = None,
    extra_member_ids: list[str] | None = None,
) -> str:
    channel_id = new_id()
    members = list(dict.fromkeys([created_by, *(extra_member_ids or [])]))

    try:
        await session.execute(
            text(
                """
                INSERT INTO channels
                  (id, workspace_id, kind, name, topic, description, created_by)
                VALUES (:id, :workspace_id, :kind, :name, :topic, :description, :created_by)
                """
            ),
            {
                "id": channel_id,
                "workspace_id": workspace_id,
                "kind": kind,
                "name": name,
                "topic": topic,
                "description": description,
                "created_by": created_by,
            },
        )
    except Exception as exc:
        if unique_violation(exc):
            raise conflict(f"#{name} already exists.", "channel_exists") from exc
        raise

    await add_members(session, channel_id, members)
    return channel_id


async def join(session: AsyncSession, channel_id: str, user_id: str) -> None:
    await add_members(session, channel_id, [user_id])


async def leave(session: AsyncSession, channel_id: str, user_id: str) -> None:
    await session.execute(
        text("DELETE FROM channel_members WHERE channel_id = :channel_id AND user_id = :user_id"),
        {"channel_id": channel_id, "user_id": user_id},
    )


def dm_key(user_ids: list[str]) -> str:
    """DMs are addressed by their member set, so opening one twice returns one channel."""
    sorted_ids = sorted(set(user_ids))
    return hashlib.sha256(":".join(sorted_ids).encode()).hexdigest()[:32]


async def find_or_create_dm(
    session: AsyncSession, workspace_id: str, user_ids: list[str]
) -> tuple[str, bool]:
    members = sorted(set(user_ids))
    key = dm_key(members)
    kind = "group_dm" if len(members) > 2 else "dm"

    existing = (
        await session.execute(
            text("SELECT id FROM channels WHERE workspace_id = :ws AND dm_key = :key"),
            {"ws": workspace_id, "key": key},
        )
    ).fetchone()
    if existing:
        return existing.id, False

    channel_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO channels (id, workspace_id, kind, dm_key, created_by)
            VALUES (:id, :ws, :kind, :key, :created_by)
            ON CONFLICT (workspace_id, dm_key) WHERE dm_key IS NOT NULL DO NOTHING
            """
        ),
        {
            "id": channel_id,
            "ws": workspace_id,
            "kind": kind,
            "key": key,
            "created_by": members[0],
        },
    )
    await add_members(session, channel_id, members)

    # Another request may have won the race; re-read to get the surviving row.
    row = (
        await session.execute(
            text("SELECT id FROM channels WHERE workspace_id = :ws AND dm_key = :key"),
            {"ws": workspace_id, "key": key},
        )
    ).fetchone()
    surviving = row.id if row else channel_id
    return surviving, surviving == channel_id



