"""Who may command an agent.

Two kinds of agent, and the difference is one nullable column. An agent with no owner is
the workspace's — installed by an admin, answering anyone who mentions it, which is what
the assistant everybody shares should do. An agent with an owner is one person's, and a
personal assistant that takes instructions from the whole room is not personal: it answers
its owner, and whoever the owner has said may use it.

The check lives here rather than in the job because it is a rule about people, and because
the job already carries a rule of its own — only a human message starts a run — that this
one sits beside rather than inside.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id


async def commandable_by(
    session: AsyncSession,
    *,
    workspace_id: str,
    actor_id: str,
    channel_id: str,
    bot_user_ids: list[str],
) -> set[str]:
    """Which of these agents `actor_id` may set going in this channel.

    One statement rather than a query per agent: a message may name several, and the
    answer for each is the same three-way test — unowned, owned by the asker, or lent to
    them. A delegation with a NULL `channel_id` applies anywhere the agent already is.

    The answer is the allowed subset rather than a verdict per agent, because a caller
    that has to distinguish "refused" from "not an agent at all" does not exist: every
    caller already knows these ids are bots, having just resolved them from a mention.
    """
    if not bot_user_ids:
        return set()

    rows = (
        await session.execute(
            text(
                """
                SELECT u.id AS bot_user_id
                  FROM users u
                  JOIN plugins p ON p.id = u.bot_plugin_id
                 WHERE u.id = ANY(cast(:bot_ids AS uuid[]))
                   AND u.workspace_id = :ws
                   AND (p.owner_user_id IS NULL
                        OR p.owner_user_id = :actor_id
                        OR EXISTS (
                             SELECT 1 FROM agent_delegations d
                              WHERE d.plugin_id = p.id
                                AND d.grantee_user_id = :actor_id
                                AND d.revoked_at IS NULL
                                AND (d.channel_id IS NULL OR d.channel_id = :channel_id)
                           ))
                """
            ),
            {
                "actor_id": actor_id,
                "channel_id": channel_id,
                "bot_ids": bot_user_ids,
                "ws": workspace_id,
            },
        )
    ).fetchall()

    return {str(row.bot_user_id) for row in rows}


async def grant(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    grantee_user_id: str,
    granted_by: str,
    channel_id: str | None,
) -> None:
    """Let somebody command this agent — here, or anywhere.

    Granting the same pair twice is not an error; it is somebody saying it again, and the
    honest answer is the grant they already have. The partial unique index is on live rows
    only, so a revoked grant does not block its own replacement.
    """
    await session.execute(
        text(
            """
            INSERT INTO agent_delegations
                (id, workspace_id, plugin_id, grantee_user_id, channel_id, granted_by)
            VALUES (:id, :ws, :plugin_id, :grantee, :channel_id, :granted_by)
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "id": new_id(),
            "ws": workspace_id,
            "plugin_id": plugin_id,
            "grantee": grantee_user_id,
            "channel_id": channel_id,
            "granted_by": granted_by,
        },
    )


async def revoke(
    session: AsyncSession, *, plugin_id: str, grantee_user_id: str, channel_id: str | None
) -> int:
    """Take it back. Answers how many grants that ended, so the caller can say so.

    Revoking "here" also ends a grant that covered everywhere — asked to stop somebody
    using an agent in this channel, ending only a narrower grant and leaving the broad one
    standing would be a refusal dressed as a success.
    """
    rows = (
        await session.execute(
            text(
                """
                UPDATE agent_delegations
                   SET revoked_at = now()
                 WHERE plugin_id = :plugin_id
                   AND grantee_user_id = :grantee
                   AND revoked_at IS NULL
                   -- Cast, because asyncpg cannot infer the type of a parameter it only
                   -- ever sees in an IS NULL test: bare, it answers "could not determine
                   -- data type of parameter $3" at runtime.
                   AND (channel_id IS NULL
                        OR cast(:channel_id AS uuid) IS NULL
                        OR channel_id = cast(:channel_id AS uuid))
                RETURNING id
                """
            ),
            {"plugin_id": plugin_id, "grantee": grantee_user_id, "channel_id": channel_id},
        )
    ).fetchall()
    return len(rows)


async def listeners(
    session: AsyncSession, *, plugin_id: str, channel_id: str | None
) -> list[tuple[str, str | None]]:
    """(display name, channel id) for everyone who may command this agent, by grant."""
    rows = (
        await session.execute(
            text(
                """
                SELECT u.display_name, d.channel_id
                  FROM agent_delegations d
                  JOIN users u ON u.id = d.grantee_user_id
                 WHERE d.plugin_id = :plugin_id
                   AND d.revoked_at IS NULL
                   AND (d.channel_id IS NULL OR d.channel_id = :channel_id)
                 ORDER BY u.display_name
                """
            ),
            {"plugin_id": plugin_id, "channel_id": channel_id},
        )
    ).fetchall()
    return [(row.display_name, row.channel_id) for row in rows]
