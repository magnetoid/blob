"""A member's own agents: the rows behind `routers/my_agents.py`.

An owned agent is an ordinary `plugins` row with `owner_user_id` set ([[0025]]), so
everything the registry knows about installing, retiring and budgeting one still
applies. What lives here is the member's view of it: which agents they may bring into a
piece of work, which are theirs, and where theirs could be put. Every lookup of "mine"
answers 404 for somebody else's agent — whose agent something is stays private, the
same way a private channel's existence does.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..lib.errors import bad_request, not_found
from ..plugins.registry import MENTIONABLE_AGENT

#: What a member's own agent looks like, from the plugin row and its bot.
OWNED_AGENT_COLUMNS = (
    "p.id, p.slug, p.name, p.description, p.status, p.created_at, u.id AS bot_user_id"
)


async def available(session: AsyncSession, user: SessionUser) -> list[Any]:
    """The agents this person may bring into a piece of work: the workspace's, and theirs.

    Somebody else's owned agent is not listed. Not out of secrecy — its bot is a member
    people can see — but because offering it would produce a refusal, and a list that
    refuses half its entries is worse than a shorter list.
    """
    return list(
        (
            await session.execute(
                text(
                    f"""
                    SELECT p.id, p.name, p.runtime, p.owner_user_id, u.id AS bot_user_id
                      FROM plugins p JOIN users u ON u.bot_plugin_id = p.id
                     WHERE p.workspace_id = :ws AND p.status = 'enabled'
                       AND u.deactivated_at IS NULL
                       AND {MENTIONABLE_AGENT}
                       AND (p.owner_user_id IS NULL OR p.owner_user_id = :me)
                     ORDER BY p.owner_user_id IS NOT NULL, lower(p.name)
                    """
                ),
                {"ws": user.workspace_id, "me": user.id},
            )
        ).fetchall()
    )


async def mine(session: AsyncSession, user: SessionUser) -> list[Any]:
    """Every agent this person owns, oldest first."""
    return list(
        (
            await session.execute(
                text(
                    f"""
                    SELECT {OWNED_AGENT_COLUMNS}
                      FROM plugins p
                      LEFT JOIN users u ON u.bot_plugin_id = p.id
                     WHERE p.workspace_id = :ws AND p.owner_user_id = :me
                     ORDER BY p.created_at
                    """
                ),
                {"ws": user.workspace_id, "me": user.id},
            )
        ).fetchall()
    )


async def owned(session: AsyncSession, user: SessionUser, agent_id: str) -> Any:
    """The agent, if it is this person's. 404 otherwise — whose it is stays private."""
    row = (
        await session.execute(
            text(
                f"""
                SELECT {OWNED_AGENT_COLUMNS}
                  FROM plugins p
                  LEFT JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.id = :id AND p.workspace_id = :ws AND p.owner_user_id = :me
                """
            ),
            {"id": agent_id, "ws": user.workspace_id, "me": user.id},
        )
    ).fetchone()
    if row is None:
        raise not_found("You have no agent by that id.")
    return row


async def free_slug(session: AsyncSession, workspace_id: str, base: str) -> str:
    """`base`, or the first `base-N` nobody holds. Slugs are per workspace and permanent."""
    taken = {
        str(r.slug)
        for r in (
            await session.execute(
                text("SELECT slug FROM plugins WHERE workspace_id = :ws AND slug LIKE :like"),
                {"ws": workspace_id, "like": f"{base}%"},
            )
        ).fetchall()
    }
    if base not in taken:
        return base
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if candidate not in taken:
            return candidate
    raise bad_request("Too many agents share that name already; pick another.")


async def channels_for(session: AsyncSession, user: SessionUser, bot_id: str | None) -> list[Any]:
    """Where this person's agent could be, and where it is.

    Only channels *the owner* is in are offered — an agent you own may not be put
    somewhere you cannot read, which is the rule the admin route applies to the admin.
    """
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.name, c.kind,
                           EXISTS (SELECT 1 FROM channel_members b
                                    WHERE b.channel_id = c.id
                                      AND b.user_id = cast(:bot AS uuid)) AS joined
                      FROM channels c
                      JOIN channel_members m ON m.channel_id = c.id AND m.user_id = :me
                     WHERE c.workspace_id = :ws
                       AND c.archived_at IS NULL
                       AND c.kind IN ('public', 'private')
                     ORDER BY c.name
                    """
                ),
                {"ws": user.workspace_id, "me": user.id, "bot": bot_id},
            )
        ).fetchall()
    )
