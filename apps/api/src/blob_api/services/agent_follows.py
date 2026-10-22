"""Channels an agent follows (ADR 0026).

An agent answers what it is asked: a mention, its DM, a task handed to it. Following a
channel is the one way an agent hears what was not addressed to it — Claude Tag's
"ambient" mode, Slack's agents that watch a channel — and it is an admin's decision,
per agent and per channel, because it changes what that agent is sent: every message a
person posts there, marked as not addressed to it, so it can stay quiet unless it has
something to add.

Nothing about authority changes. A followed message is a person's message, so the run
it starts roots a chain on that person's authority (ADR 0013), bounded by the room
(ADR 0022) — and only with Blob's read tools, never a write or a question to another
agent, since nobody asked it anything. Admission (`jobs/agui_admission.py`) holds the
throttle: a cooldown per agent and channel, and a daily cap.

**What it hears** (M4, ADR 0026's addendum) narrows that per channel: every message
(`everything`, as before), only a message that carries a file (`files`), or only a question
nobody has answered within the quiet time an admin chose (`unanswered`) — which reaches the
agent from a cron (`unanswered_questions`), not as it is posted, and means "unanswered"
exactly as the nudges do (`unanswered.UNANSWERED`). The person at the root is still the
asker, whose message it is.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, not_found
from ..plugins.registry import MENTIONABLE_AGENT
from .unanswered import UNANSWERED, time_id

#: What an agent may hear in a channel it follows.
HEARS = ("everything", "files", "unanswered")
#: How long a question may go unanswered before an agent following for that hears it.
QUIET_CHOICES = (30, 60, 240, 1440)
DEFAULT_QUIET = 60
#: How far past its quiet time a question is still handed on: a sweep that missed a few
#: ticks catches up, and a question older than that is left alone — a late answer from an
#: agent nobody asked is worse than none.
LATE_LOOKBACK_MINUTES = 120
LATE_BATCH = 50


async def follow(
    session: AsyncSession,
    *,
    workspace_id: str,
    plugin_id: str,
    channel_id: str,
    by: str,
    hears: str | None = None,
    quiet_minutes: int | None = None,
) -> None:
    """Let this agent hear the channel — everything, files, or the questions nobody
    answered within `quiet_minutes`. Idempotent; `hears` left out keeps what a follow
    already hears, and starts a new one hearing everything.

    Refused, with the reason, for an app that is not an agent, for a direct or group
    message — following is for channels, never for a conversation between people — and
    for a channel the agent's bot is not in: following is not joining, and an agent that
    could not answer there would be sent every line for nothing.
    """
    if hears is not None and hears not in HEARS:
        raise bad_request("An agent hears everything, files, or unanswered questions.")
    if hears == "unanswered":
        quiet_minutes = DEFAULT_QUIET if quiet_minutes is None else quiet_minutes
        if quiet_minutes not in QUIET_CHOICES:
            raise bad_request(
                "A question waits half an hour, an hour, four hours or a day.",
                code="invalid_input",
            )
    else:
        quiet_minutes = None
    agent = (
        await session.execute(
            text(
                f"""
                SELECT p.name, u.id AS bot_user_id
                  FROM plugins p JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.id = :plugin AND p.workspace_id = :ws AND {MENTIONABLE_AGENT}
                """
            ),
            {"plugin": plugin_id, "ws": workspace_id},
        )
    ).fetchone()
    if agent is None:
        raise bad_request(
            "Only an agent that answers over AG-UI can follow a channel.", code="not_an_agent"
        )
    channel = (
        await session.execute(
            text(
                """
                SELECT c.kind, c.archived_at,
                       EXISTS (SELECT 1 FROM channel_members m
                                WHERE m.channel_id = c.id AND m.user_id = :bot) AS seated
                  FROM channels c WHERE c.id = :channel AND c.workspace_id = :ws
                """
            ),
            {"channel": channel_id, "ws": workspace_id, "bot": agent.bot_user_id},
        )
    ).fetchone()
    if channel is None:
        raise not_found("There is no channel by that name.")
    if channel.kind not in ("public", "private"):
        raise bad_request("An agent follows channels, not conversations between people.")
    if channel.archived_at is not None:
        raise bad_request("That channel is archived.")
    if not channel.seated:
        raise bad_request(
            f"{agent.name} isn't in that channel. Add it there first.", code="agent_not_in_channel"
        )
    params = {
        "plugin": plugin_id,
        "channel": channel_id,
        "ws": workspace_id,
        "by": by,
        "hears": hears or "everything",
        "quiet": quiet_minutes,
    }
    if hears is None:
        await session.execute(
            text(
                """
                INSERT INTO agent_follows
                       (plugin_id, channel_id, workspace_id, created_by, hears, quiet_minutes)
                VALUES (:plugin, :channel, :ws, :by, :hears, :quiet)
                ON CONFLICT (plugin_id, channel_id) DO NOTHING
                """
            ),
            params,
        )
        return
    await session.execute(
        text(
            """
            INSERT INTO agent_follows
                   (plugin_id, channel_id, workspace_id, created_by, hears, quiet_minutes)
            VALUES (:plugin, :channel, :ws, :by, :hears, :quiet)
            ON CONFLICT (plugin_id, channel_id)
            DO UPDATE SET hears = EXCLUDED.hears, quiet_minutes = EXCLUDED.quiet_minutes
            """
        ),
        params,
    )


async def unfollow(
    session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str
) -> bool:
    """Stop hearing the channel. True if it was following it."""
    gone = (
        await session.execute(
            text(
                """
                DELETE FROM agent_follows
                 WHERE plugin_id = :plugin AND channel_id = :channel AND workspace_id = :ws
                RETURNING plugin_id
                """
            ),
            {"plugin": plugin_id, "channel": channel_id, "ws": workspace_id},
        )
    ).fetchall()
    return bool(gone)


async def channels_of(session: AsyncSession, *, workspace_id: str, plugin_id: str) -> list[Any]:
    """The channels this agent follows, by name — for the admin's page, which sees every
    channel in the workspace."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.name, c.kind, f.created_at, f.hears, f.quiet_minutes
                      FROM agent_follows f JOIN channels c ON c.id = f.channel_id
                     WHERE f.plugin_id = :plugin AND f.workspace_id = :ws
                     ORDER BY lower(c.name)
                    """
                ),
                {"plugin": plugin_id, "ws": workspace_id},
            )
        ).fetchall()
    )


async def is_followed(session: AsyncSession, *, channel_id: str) -> bool:
    """Whether any agent hears this channel's messages as they are posted — asked as a
    message is sent, so a person's message there is handed to the run job even though it
    mentions nobody. One indexed lookup (`agent_follows_channel`); which agents, and whether
    they may go, is the job's. A follow for unanswered questions hears nothing then: the
    cron hands those on (`unanswered_questions`)."""
    return bool(
        (
            await session.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM agent_follows"
                    " WHERE channel_id = :channel AND hears <> 'unanswered')"
                ),
                {"channel": channel_id},
            )
        ).scalar_one()
    )


async def unanswered_questions(session: AsyncSession, *, now: datetime) -> list[tuple[str, str]]:
    """(question, agent) pairs due now: a person's question in a channel an agent follows
    for unanswered ones, gone that follow's quiet time without an answer — and not more
    than `LATE_LOOKBACK_MINUTES` past it — with the agent still in the channel and not
    already run on it (mentioned there, or handed it by an earlier sweep).

    The id bounds are the widest any follow could want and pick the index; each follow's
    own window is the `created_at` pair."""
    widest = max(QUIET_CHOICES) + LATE_LOOKBACK_MINUTES + 1
    rows = (
        await session.execute(
            text(
                f"""
                SELECT m.id AS message_id, f.plugin_id
                  FROM agent_follows f
                  JOIN channels c ON c.id = f.channel_id
                  JOIN users bot ON bot.bot_plugin_id = f.plugin_id
                  JOIN channel_members seat
                    ON seat.channel_id = c.id AND seat.user_id = bot.id
                  JOIN messages m ON m.channel_id = c.id
                  JOIN users u ON u.id = m.author_id
                 WHERE f.hears = 'unanswered'
                   AND c.archived_at IS NULL
                   AND c.kind IN ('public', 'private')
                   AND m.id >= cast(:floor_id AS uuid)
                   AND m.id <  cast(:ceiling_id AS uuid)
                   AND m.created_at
                       <= cast(:now AS timestamptz) - make_interval(mins => f.quiet_minutes)
                   AND m.created_at
                       >  cast(:now AS timestamptz)
                          - make_interval(mins => f.quiet_minutes + :lookback)
                   AND {UNANSWERED}
                   AND u.kind = 'human'
                   AND u.deactivated_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM agent_runs r
                                    WHERE r.trigger_message_id = m.id
                                      AND r.plugin_id = f.plugin_id)
                 ORDER BY m.id
                 LIMIT :batch
                """
            ),
            {
                "floor_id": time_id(now - timedelta(minutes=widest)),
                "ceiling_id": time_id(now - timedelta(minutes=min(QUIET_CHOICES) - 1)),
                "now": now,
                "lookback": LATE_LOOKBACK_MINUTES,
                "batch": LATE_BATCH,
            },
        )
    ).fetchall()
    return [(str(row.message_id), str(row.plugin_id)) for row in rows]


async def still_unanswered(session: AsyncSession, *, message_id: str) -> bool:
    """Whether this question is still unanswered — asked again by the run that would answer
    it, since a reply may have landed between the sweep and the job."""
    return bool(
        (
            await session.execute(
                text(f"SELECT EXISTS (SELECT 1 FROM messages m WHERE m.id = :id AND {UNANSWERED})"),
                {"id": message_id},
            )
        ).scalar_one()
    )


__all__ = [
    "DEFAULT_QUIET",
    "HEARS",
    "QUIET_CHOICES",
    "channels_of",
    "follow",
    "is_followed",
    "still_unanswered",
    "unanswered_questions",
    "unfollow",
]
