"""The server as a whole: every account and every workspace on it.

What the instance console reads. Nothing here is scoped by workspace on purpose — an
instance admin is the one caller who is allowed to see across them — which is why the
router gates it with `require_instance_admin` and nothing else calls it.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def all_users(session: AsyncSession) -> list[Any]:
    """Every account on the server, whichever workspace it belongs to."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.email, u.display_name, u.role, u.kind,
                           u.workspace_id, w.name AS workspace_name,
                           u.deactivated_at, u.created_at
                      FROM users u
                      JOIN workspaces w ON w.id = u.workspace_id
                     ORDER BY w.name, lower(u.display_name) LIMIT 1000
                    """
                )
            )
        ).fetchall()
    )


async def all_workspaces(session: AsyncSession) -> list[Any]:
    """Every workspace, with enough to tell them apart at a glance.

    Counted in one pass with correlated subqueries rather than three joins and a GROUP
    BY: at the number of workspaces a self-hosted server holds, clarity is worth more
    than the query plan, and each count reads as the sentence it answers.
    """
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT w.id, w.name, w.slug, w.created_at,
                           (SELECT count(*) FROM users u
                             WHERE u.workspace_id = w.id
                               AND u.deactivated_at IS NULL) AS member_count,
                           (SELECT count(*) FROM channels c
                             WHERE c.workspace_id = w.id
                               AND c.kind IN ('public', 'private')) AS channel_count,
                           (SELECT count(*) FROM plugins p
                             WHERE p.workspace_id = w.id) AS app_count
                      FROM workspaces w
                     ORDER BY w.created_at LIMIT 1000
                    """
                )
            )
        ).fetchall()
    )
