"""Who answers a mention.

The admission half of `jobs/agui.py`: which bots a message reached and may run
(`listeners_for`), whether a DM is one person's private room with an agent the room may
address (`personal_agent_for`), and the typing indicator a run shows while it thinks
(`looks_busy`). None of this contacts an agent; all of it decides whether and how one is
contacted.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.redis import redis
from ..plugins.registry import MENTIONABLE_AGENT
from ..plugins.streams import Listener
from ..realtime import presence
from ..realtime.protocol import TYPING_TTL_MS
from ..services import seeded

log = logging.getLogger("blob.jobs.agui")


#: What a run needs to know about an agent, read the same way whichever way it was
#: addressed — a mention or the room — so the two cannot drift.
_LISTENER_COLUMNS = f"""
           p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
           p.runtime, s.signing_secret, p.owner_user_id,
           p.agui_version, p.shows_reasoning, p.tool_access, p.write_approval,
           -- Whose text this is, asked here rather than trusted from the column: the
           -- routes only ever write it onto the seeded agent, but a row can hold text
           -- those routes never wrote — a backup taken before the rule, a psql prompt.
           -- Forwarding it would hand a third-party app's endpoint a prompt its author
           -- never declared a field for, so the run path decides for itself.
           CASE WHEN {seeded.SEEDED_AGENT} THEN p.instructions END AS instructions
"""
_LISTENER_FROM = """
      FROM plugins p
      JOIN users u ON u.bot_plugin_id = p.id
      JOIN plugin_secrets s ON s.plugin_id = p.id
"""
_LISTENER_SELECT = f"SELECT {_LISTENER_COLUMNS} {_LISTENER_FROM}"

#: What makes an agent able to answer at all. The enabled-and-scoped filter is the same
#: one the bot API and the delivery drain apply: an app that was disabled or had
#: `messages:write` revoked must not keep answering because a message reached a queue
#: first. And it must be reachable — an address, or a connection it opened itself: a
#: socket agent has no `agui_url`, so the URL test alone would filter out every one.
_ANSWERS = f"""
    p.workspace_id = :ws
    AND p.status = 'enabled'
    AND {MENTIONABLE_AGENT}
    AND u.deactivated_at IS NULL
    AND EXISTS (
      SELECT 1 FROM plugin_grants g
       WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
"""


def _listener(row: Any) -> Listener:
    return Listener(
        plugin_id=row.id,
        slug=row.slug,
        name=row.name,
        bot_user_id=row.bot_user_id,
        agui_url=row.agui_url,
        signing_secret=row.signing_secret,
        runtime=row.runtime,
        instructions=row.instructions,
        owner_user_id=str(row.owner_user_id) if row.owner_user_id else None,
        agui_version=row.agui_version,
        shows_reasoning=bool(row.shows_reasoning),
        tool_access=row.tool_access,
        write_approval=row.write_approval,
    )


async def listeners_for(
    session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str]
) -> list[Listener]:
    """Mentioned bots whose app speaks AG-UI, is enabled, and may post."""
    if not mention_user_ids:
        return []
    rows = (
        await session.execute(
            text(
                f"""
                {_LISTENER_SELECT}
                 WHERE {_ANSWERS}
                   AND u.id = ANY(cast(:ids AS uuid[]))
                """
            ),
            {"ws": workspace_id, "ids": mention_user_ids},
        )
    ).fetchall()
    return [_listener(row) for row in rows]


async def personal_agent_for(
    session: AsyncSession, *, workspace_id: str, channel_id: str
) -> Listener | None:
    """The agent this channel is one person's private room with, when that agent may be
    addressed by the room.

    A DM with an agent needs no mention, because there is nobody else the line could be
    addressed to — which is the whole reason a personal agent works without a second
    identity, a second bot, or a row anywhere. The room is what makes it personal.

    **Every condition is in the statement, and none of them is `kind` alone.** `kind` is
    set from the member count when a DM is created and never re-derived, while
    `app_join_channel` can add a bot to a channel with no kind test at all — so a
    `kind='dm'` row can hold three members, and a design that trusted the label would put
    a model told "this is your private room with Ada" into a room Bo is also reading. The
    count is therefore checked directly, in the same query as everything else.

    Never "any bot in a DM", deliberately. That would hand every installed third-party
    app a run for every line typed at it, with no manifest opt-in and no way for its
    author to decline — a change to somebody else's contract, smuggled in as a
    convenience. So the room is the address in exactly two cases: a *resident* agent
    (`plugins.answers_dm_without_mention`, set only by the seeder), and the person's own
    agent (`plugins.owner_user_id` is the one person in the room — ADR 0018, "your
    agent answers you").

    That it can be reached at all (`_ANSWERS`) matters here as much as for a mention:
    `set_owner` will hand *any* installed app to a person, so without it a
    request_url-only app given to somebody makes their DM with it answer, every plain
    line, with "that agent has no endpoint to call" — see `plugins/streams`.
    """
    row = (
        await session.execute(
            text(
                f"""
                {_LISTENER_SELECT}
                  JOIN channels c ON c.id = :channel_id
                                 AND c.workspace_id = p.workspace_id
                                 AND c.kind = 'dm'
                  -- The bot is in the room ...
                  JOIN channel_members bot_m ON bot_m.channel_id = c.id
                                            AND bot_m.user_id = u.id
                  -- ... and exactly one other person is, who is a person.
                  JOIN channel_members other_m ON other_m.channel_id = c.id
                                              AND other_m.user_id <> u.id
                  JOIN users other ON other.id = other_m.user_id
                                  AND other.kind = 'human'
                                  AND other.deactivated_at IS NULL
                 WHERE {_ANSWERS}
                   -- The room is the address for a resident agent, and for the
                   -- person's own agent. Never for an app installed by hand.
                   AND (p.answers_dm_without_mention OR p.owner_user_id = other.id)
                   -- Two members and no more. `kind` cannot be trusted for this.
                   AND (SELECT count(*) FROM channel_members m
                         WHERE m.channel_id = c.id) = 2
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id},
        )
    ).fetchone()
    return _listener(row) if row is not None else None


#: How long a followed channel stays quiet to an agent after one of its messages started
#: a run there, and how many such runs one agent may have in one channel a day. A channel
#: in full flow is one conversation, not forty questions; the cap is the dam behind it.
FOLLOW_COOLDOWN_SEC = 120
FOLLOW_DAILY_CAP = 40


def _follower(row: Any) -> Listener:
    return replace(
        _listener(row), addressed=False, hears=row.hears, quiet_minutes=row.quiet_minutes
    )


async def followers_for(
    session: AsyncSession, *, workspace_id: str, channel_id: str, message_id: str
) -> list[Listener]:
    """The agents following this channel that hear this message as it is posted (ADR 0026),
    marked as not addressed: those hearing everything, and those hearing files when it
    carries one — a file, never a voice message, which wakes no follower (ADR 0035). A
    follow for unanswered questions hears nothing now; the cron hands those on.

    The same reachability a mention needs (`_ANSWERS`), and the bot still a member: an
    admin follows a channel *for* an agent, and a bot removed since has nothing to hear
    it with."""
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {_LISTENER_COLUMNS}, f.hears, f.quiet_minutes {_LISTENER_FROM}
                  JOIN agent_follows f ON f.plugin_id = p.id AND f.channel_id = :channel_id
                  JOIN channel_members m ON m.channel_id = f.channel_id AND m.user_id = u.id
                 WHERE {_ANSWERS}
                   AND (
                     f.hears = 'everything'
                     OR (f.hears = 'files' AND EXISTS (
                           SELECT 1 FROM attachments a
                            WHERE a.message_id = :message AND a.kind = 'file'))
                   )
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id, "message": message_id},
        )
    ).fetchall()
    return [_follower(row) for row in rows]


async def unanswered_follower(
    session: AsyncSession, *, workspace_id: str, channel_id: str, plugin_id: str
) -> Listener | None:
    """This agent, if it still follows this channel for unanswered questions and could
    answer there — what the cron's hand-on is checked against when its job runs."""
    row = (
        await session.execute(
            text(
                f"""
                SELECT {_LISTENER_COLUMNS}, f.hears, f.quiet_minutes {_LISTENER_FROM}
                  JOIN agent_follows f ON f.plugin_id = p.id AND f.channel_id = :channel_id
                  JOIN channel_members m ON m.channel_id = f.channel_id AND m.user_id = u.id
                 WHERE {_ANSWERS}
                   AND p.id = :plugin
                   AND f.hears = 'unanswered'
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id, "plugin": plugin_id},
        )
    ).fetchone()
    return _follower(row) if row is not None else None


async def may_follow_now(plugin_id: str, channel_id: str) -> bool:
    """Whether a followed message may start a run now: off cooldown, under the day's cap.

    In Redis, so every worker shares one answer, and set-if-absent so two messages a
    moment apart cannot both pass. **Fails closed**, unlike the rate limiter: a guard that
    lets a follow through when Redis is away would send an agent every line of a busy
    channel — the one thing following must never do. A mention still works; only the
    unasked runs pause.
    """
    try:
        quiet = await redis.set(
            f"follow:quiet:{plugin_id}:{channel_id}", "1", nx=True, ex=FOLLOW_COOLDOWN_SEC
        )
        if not quiet:
            return False
        day = datetime.now(UTC).strftime("%Y-%m-%d")
        key = f"follow:count:{plugin_id}:{channel_id}:{day}"
        count = int(await redis.incr(key))
        if count == 1:
            await redis.expire(key, 2 * 24 * 3600)
        return count <= FOLLOW_DAILY_CAP
    except Exception:
        log.warning("follow throttle unavailable; not following for now", exc_info=True)
        return False


@asynccontextmanager
async def looks_busy(
    listener: Listener, channel_id: str, thread_root_id: str | None, *, shown: bool = True
) -> AsyncIterator[None]:
    """Show the agent typing for as long as it is thinking.

    Not `shown` for a run nobody addressed (ADR 0026): an agent following a channel would
    otherwise type under every message posted there.

    Nothing reaches the client until an answer is *sealed* — `Fold` emits a post on
    TEXT_MESSAGE_END, not per delta — so a run is up to two minutes of an empty room. In
    a channel that reads as normal; in a DM, where the person is sitting there waiting,
    it is indistinguishable from the feature being broken.

    This costs no client change and no protocol change, because the typing indicator is
    already built, already broadcast per channel, and already rendered — the agent simply
    starts using the thing people use. It is re-armed inside the TTL rather than set once,
    since the indicator is deliberately short-lived so that a crashed client stops
    claiming somebody is typing forever.

    Failures are swallowed on purpose. A cosmetic indicator must never be able to stop an
    answer from being written.
    """
    if not shown:
        yield
        return
    interval = max(1.0, (TYPING_TTL_MS / 1000) * 0.6)

    async def signal() -> None:
        try:
            await presence.set_typing(channel_id, listener.bot_user_id, thread_root_id)
        except Exception:
            # A cosmetic indicator must never be able to stop an answer being written.
            log.debug("could not signal typing", exc_info=True)

    async def beat() -> None:
        while True:
            await asyncio.sleep(interval)
            await signal()

    # Signalled once here rather than only inside the task: `create_task` schedules, it
    # does not run, so against a fast model the whole run can finish before the loop gets
    # its first slot and the indicator would never appear at all. The person should see it
    # the moment the run starts, which is now.
    await signal()
    task = asyncio.create_task(beat())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
