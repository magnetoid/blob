"""Whom somebody tagged most recently, for the `@` picker.

The picker's first row is what Enter takes, so its order decides who gets notified. A
bare `@` used to offer the workspace alphabetically; with this it offers the people you
were just talking to, which is what Slack's picker does and what someone reaching for a
name expects.

Read off the person's own messages at boot rather than stored as a list of its own.
There is then nothing to keep in step with sends, edits and deletes, and nothing that
remembers whom somebody talks to after they have deleted what they said.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: How many of the person's newest messages are read. A bound on the work, counted in
#: messages rather than in mentions: counted in mentions, somebody who rarely tags anyone
#: would have every boot walk their whole history looking for the next one.
SCAN_LIMIT = 2000

#: How many people, and separately how many groups, the client is told about. The
#: picker shows six people, so this is recency deep enough to reach past a whole screen
#: of it, not a history.
KEEP = 30


@dataclass(frozen=True, slots=True)
class RecentMentions:
    user_ids: list[str]
    group_ids: list[str]


async def recent_mentions(session: AsyncSession, user_id: str) -> RecentMentions:
    """The people and groups this person tagged, most recent first, each once.

    Within one message the names keep the order they were written in, which is also the
    order the client puts them in when a message of your own arrives.

    Deleted messages tag nobody. You are not in your own list. Somebody deactivated since
    is left out, as is a group that no longer exists: the picker could not offer either,
    and each would hold one of the `KEEP` places. The workspace comes from the author's
    own row inside the statement rather than from a parameter, so no caller can forget it
    and an id survives only by belonging here.

    Only messages the person wrote themselves count. An incoming webhook posts as the
    admin who created it, with kind `bot`, and whom it names is the integration's
    business. That filter runs after the scan's limit rather than inside it, so a busy
    webhook can use up the window but can never make the scan read further back.
    """
    rows = (
        await session.execute(
            text(
                """
                WITH recent AS MATERIALIZED (
                    SELECT id, kind, deleted_at, mention_user_ids, mention_group_ids
                      FROM messages
                     WHERE author_id = :me
                     ORDER BY id DESC
                     LIMIT :scan
                ),
                named AS (
                    SELECT 'user' AS target_kind, r.id AS message_id, n.target, n.place
                      FROM recent r
                     CROSS JOIN LATERAL unnest(r.mention_user_ids)
                           WITH ORDINALITY AS n(target, place)
                     WHERE r.deleted_at IS NULL AND r.kind = 'user'
                    UNION ALL
                    SELECT 'group', r.id, n.target, n.place
                      FROM recent r
                     CROSS JOIN LATERAL unnest(r.mention_group_ids)
                           WITH ORDINALITY AS n(target, place)
                     WHERE r.deleted_at IS NULL AND r.kind = 'user'
                ),
                latest AS (
                    -- Each target once, at the newest message that named it.
                    SELECT DISTINCT ON (target_kind, target)
                           target_kind, target, message_id, place
                      FROM named
                     ORDER BY target_kind, target, message_id DESC, place
                ),
                live AS (
                    SELECT l.target_kind, l.target, l.message_id, l.place
                      FROM latest l
                      JOIN users me ON me.id = :me
                     WHERE (l.target_kind = 'user'
                            AND l.target <> me.id
                            AND EXISTS (
                                SELECT 1 FROM users u
                                 WHERE u.id = l.target
                                   AND u.workspace_id = me.workspace_id
                                   AND u.deactivated_at IS NULL))
                        OR (l.target_kind = 'group'
                            AND EXISTS (
                                SELECT 1 FROM user_groups g
                                 WHERE g.id = l.target
                                   AND g.workspace_id = me.workspace_id))
                ),
                ranked AS (
                    SELECT target_kind, target,
                           row_number() OVER (
                               PARTITION BY target_kind ORDER BY message_id DESC, place
                           ) AS rank
                      FROM live
                )
                SELECT target_kind, target FROM ranked
                 WHERE rank <= :keep
                 ORDER BY target_kind, rank
                """
            ),
            {"me": user_id, "scan": SCAN_LIMIT, "keep": KEEP},
        )
    ).fetchall()
    return RecentMentions(
        user_ids=[str(row.target) for row in rows if row.target_kind == "user"],
        group_ids=[str(row.target) for row in rows if row.target_kind == "group"],
    )
