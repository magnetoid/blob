"""Allocating a mentionable name, so two things can never answer to one.

A mention is resolved against a single map of lowercased-name to target. Display names
and group handles both live in that map, so they must not be able to collide — and a pair
of application checks cannot guarantee it. Not because of a race: through a supported
flow. `users_display_name_uniq` is partial on `deactivated_at IS NULL`, so a group-create
check has to ignore deactivated people, or a departed account holds a name for ever.
Deactivate somebody, create a group with their handle, reactivate them — both checks pass
and the collision exists, in two tables no index can span.

So a name is *allocated*, not checked. Winning `(workspace_id, handle_lower)` is what
makes it yours, and losing raises 23505, which every caller already knows how to turn into
`conflict(..., code="name_taken")`. That is the same ruling `plugins/manifest.py` makes
about command names — an index decides, not a read followed by a write — applied to the
case where the escape hatch looked unavailable because two tables were involved.

**`lower()` here is always Postgres'.** Python's `str.lower()` applies full case mapping
and expands "İ" to two code points; Postgres applies the simple mapping and returns "i".
The stored key has to be the SQL one, because the resolver compares against this column —
and `lib.mentions.parse_mentions` offers both spellings on the lookup side to meet it.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def claim(
    session: AsyncSession,
    workspace_id: str,
    name: str,
    *,
    user_id: str | None = None,
    group_id: str | None = None,
) -> None:
    """Take a name for a user or a group. Raises on 23505 if it is taken.

    Deliberately lets the violation surface rather than pre-checking: the caller maps it
    to a `conflict`, and a check here would reintroduce exactly the read-then-write this
    table exists to remove.
    """
    await session.execute(
        text(
            """
            INSERT INTO workspace_handles (workspace_id, handle_lower, user_id, group_id)
            VALUES (:ws, lower(:name), cast(:user_id AS uuid), cast(:group_id AS uuid))
            """
        ),
        {"ws": workspace_id, "name": name, "user_id": user_id, "group_id": group_id},
    )


async def release_user(session: AsyncSession, user_id: str) -> None:
    """Give up whatever handle this person holds — deactivation, or a rename.

    By owner rather than by name, so it cannot leave a stale row behind when the caller's
    idea of the old name has drifted from what was actually stored. The partial unique
    index on `user_id` makes "whatever they hold" exactly one row.
    """
    await session.execute(
        text("DELETE FROM workspace_handles WHERE user_id = cast(:id AS uuid)"),
        {"id": user_id},
    )


async def release_group(session: AsyncSession, group_id: str) -> None:
    await session.execute(
        text("DELETE FROM workspace_handles WHERE group_id = cast(:id AS uuid)"),
        {"id": group_id},
    )


async def rehandle_user(
    session: AsyncSession, workspace_id: str, user_id: str, name: str
) -> None:
    """Move a person onto a new name, releasing the old one in the same statement pair.

    Release first: claiming first would collide with the caller's own current handle when
    a rename only changes case, which is a rename somebody will do on their first day.
    """
    await release_user(session, user_id)
    await claim(session, workspace_id, name, user_id=user_id)


async def is_taken(session: AsyncSession, workspace_id: str, name: str) -> bool:
    """Only for suggesting an alternative, never for guarding a write.

    `plugins/registry._available_display_name` needs to *pick* a free name rather than
    fail, which is a different job from allocation and the one place a probe is honest.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT 1 FROM workspace_handles
                 WHERE workspace_id = :ws AND handle_lower = lower(:name)
                """
            ),
            {"ws": workspace_id, "name": name},
        )
    ).fetchone()
    return row is not None
