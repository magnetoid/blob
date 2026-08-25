"""Named sets of people, mentionable as one handle.

The handle is allocated through `services/handles`, not checked for here, so a group and
a person can never both answer to one name — see that module for why a check cannot do it.

Membership is resolved at *notify* time rather than frozen into a message, so nothing in
here writes to `messages`. That is the decision the whole feature turns on: a message
stores the group it named, and who that means is answered when it matters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from . import handles as handle_service

#: The same shape the CHECK constraint enforces. Duplicated deliberately: the constraint
#: is the guarantee, this is the *message* — a raw 23514 tells somebody nothing about
#: which rule they broke.
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")

HANDLE_HELP = (
    "Two to thirty-two characters: lowercase letters, numbers and hyphens, "
    "starting with a letter or number."
)


@dataclass(slots=True)
class Group:
    id: str
    handle: str
    name: str
    description: str | None
    member_count: int


def clean_handle(raw: str) -> str:
    """Normalise what somebody typed, then insist on the rule.

    A leading `@` is stripped because that is how people write a handle when they are
    thinking of mentioning it, and refusing it would be pedantry.
    """
    handle = raw.strip().lstrip("@").lower()
    if not HANDLE_RE.match(handle):
        raise bad_request(HANDLE_HELP, code="invalid_input")
    return handle


async def create(
    session: AsyncSession,
    *,
    workspace_id: str,
    handle: str,
    name: str,
    description: str | None,
    created_by: str,
) -> str:
    group_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO user_groups (id, workspace_id, handle, name, description, created_by)
            VALUES (:id, :ws, :handle, :name, :description, :created_by)
            """
        ),
        {
            "id": group_id,
            "ws": workspace_id,
            "handle": handle,
            "name": name.strip() or handle,
            "description": (description or "").strip() or None,
            "created_by": created_by,
        },
    )
    # Losing this is what tells the caller the name is taken — by a person or by another
    # group, indistinguishably, which is the point of one namespace.
    await handle_service.claim(session, workspace_id, handle, group_id=group_id)
    return group_id


async def rename(
    session: AsyncSession,
    *,
    workspace_id: str,
    group_id: str,
    handle: str | None,
    name: str | None,
    description: str | None,
    touch_description: bool,
) -> None:
    current = await by_id(session, workspace_id, group_id)
    if current is None:
        raise not_found("There is no such group here.")

    await session.execute(
        text(
            """
            UPDATE user_groups
               SET handle = COALESCE(:handle, handle),
                   name = COALESCE(:name, name),
                   description = CASE WHEN :touch THEN :description ELSE description END
             WHERE id = :id AND workspace_id = :ws
            """
        ),
        {
            "id": group_id,
            "ws": workspace_id,
            "handle": handle,
            "name": name,
            "touch": touch_description,
            "description": (description or "").strip() or None if touch_description else None,
        },
    )
    if handle is not None and handle != current.handle:
        # Release then claim, so changing only the case of a handle does not collide
        # with the row this group already holds.
        await handle_service.release_group(session, group_id)
        await handle_service.claim(session, workspace_id, handle, group_id=group_id)


async def delete(session: AsyncSession, workspace_id: str, group_id: str) -> None:
    """Remove the group. The handle row goes with it by cascade.

    Messages that named it keep their `mention_group_ids` — the mention *happened*, and
    rewriting history to pretend otherwise is exactly what the storage decision avoids.
    They simply resolve to nobody, which is what a deleted group means.
    """
    removed = (
        await session.execute(
            text("DELETE FROM user_groups WHERE id = :id AND workspace_id = :ws RETURNING id"),
            {"id": group_id, "ws": workspace_id},
        )
    ).fetchone()
    if removed is None:
        raise not_found("There is no such group here.")


async def add_member(session: AsyncSession, workspace_id: str, group_id: str, user_id: str) -> None:
    """Put somebody in a group. Humans only, and idempotent.

    `kind = 'human'` is enforced in the SELECT rather than by a constraint, which would
    have to span tables. It matters more than it looks: a group mention notifies through
    `mention_group_ids`, and a bot in a group would be a member who can never read it —
    while `@channel`, the closest thing this app already has, wakes no agent at all.
    """
    inserted = (
        await session.execute(
            text(
                """
                INSERT INTO user_group_members (group_id, user_id)
                SELECT g.id, u.id
                  FROM user_groups g
                  JOIN users u ON u.id = cast(:user_id AS uuid)
                 WHERE g.id = cast(:group_id AS uuid)
                   AND g.workspace_id = :ws
                   AND u.workspace_id = :ws
                   AND u.kind = 'human'
                   AND u.deactivated_at IS NULL
                ON CONFLICT DO NOTHING
                RETURNING user_id
                """
            ),
            {"group_id": group_id, "user_id": user_id, "ws": workspace_id},
        )
    ).fetchone()
    if inserted is None:
        # Either already a member (fine, idempotent) or not addable at all. Tell the two
        # apart with one read rather than guessing.
        if not await exists(session, workspace_id, group_id):
            raise not_found("There is no such group here.")


async def remove_member(
    session: AsyncSession, workspace_id: str, group_id: str, user_id: str
) -> None:
    await session.execute(
        text(
            """
            DELETE FROM user_group_members
             WHERE user_id = cast(:user_id AS uuid)
               AND group_id = (
                 SELECT id FROM user_groups
                  WHERE id = cast(:group_id AS uuid) AND workspace_id = :ws)
            """
        ),
        {"group_id": group_id, "user_id": user_id, "ws": workspace_id},
    )


async def set_muted(session: AsyncSession, group_id: str, user_id: str, muted: bool) -> bool:
    """Your own switch for a group you are in. Returns False if you are not in it."""
    row = (
        await session.execute(
            text(
                """
                UPDATE user_group_members SET muted = :muted
                 WHERE group_id = cast(:group_id AS uuid)
                   AND user_id = cast(:user_id AS uuid)
                RETURNING user_id
                """
            ),
            {"group_id": group_id, "user_id": user_id, "muted": muted},
        )
    ).fetchone()
    return row is not None


async def exists(session: AsyncSession, workspace_id: str, group_id: str) -> bool:
    return (await by_id(session, workspace_id, group_id)) is not None


async def by_id(session: AsyncSession, workspace_id: str, group_id: str) -> Group | None:
    row = (
        await session.execute(
            text(
                """
                SELECT g.id, g.handle, g.name, g.description,
                       (SELECT count(*)::int FROM user_group_members m WHERE m.group_id = g.id)
                         AS member_count
                  FROM user_groups g
                 WHERE g.id = cast(:id AS uuid) AND g.workspace_id = :ws
                """
            ),
            {"id": group_id, "ws": workspace_id},
        )
    ).fetchone()
    return _to_group(row) if row else None


async def list_for_workspace(session: AsyncSession, workspace_id: str) -> list[Group]:
    rows = (
        await session.execute(
            text(
                """
                SELECT g.id, g.handle, g.name, g.description,
                       (SELECT count(*)::int FROM user_group_members m WHERE m.group_id = g.id)
                         AS member_count
                  FROM user_groups g
                 WHERE g.workspace_id = :ws
                 ORDER BY g.handle
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return [_to_group(row) for row in rows]


async def member_ids(session: AsyncSession, group_id: str) -> list[str]:
    rows = (
        await session.execute(
            text(
                """
                SELECT m.user_id
                  FROM user_group_members m
                  JOIN users u ON u.id = m.user_id
                 WHERE m.group_id = cast(:id AS uuid) AND u.deactivated_at IS NULL
                 ORDER BY lower(u.display_name)
                """
            ),
            {"id": group_id},
        )
    ).fetchall()
    return [str(row.user_id) for row in rows]


async def group_ids_for_user(session: AsyncSession, user_id: str) -> list[str]:
    """Which groups this person is in — for the boot payload, so the client can tell
    whether a group mention is about them."""
    rows = (
        await session.execute(
            text("SELECT group_id FROM user_group_members WHERE user_id = :id"),
            {"id": user_id},
        )
    ).fetchall()
    return [str(row.group_id) for row in rows]


def _to_group(row: Any) -> Group:
    return Group(
        id=str(row.id),
        handle=row.handle,
        name=row.name,
        description=row.description,
        member_count=row.member_count,
    )
