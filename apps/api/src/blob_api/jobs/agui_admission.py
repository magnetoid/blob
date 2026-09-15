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

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..plugins.registry import MENTIONABLE_AGENT
from ..plugins.streams import Listener
from ..realtime import presence
from ..realtime.protocol import TYPING_TTL_MS

log = logging.getLogger("blob.jobs.agui")


async def listeners_for(
    session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str]
) -> list[Listener]:
    """Mentioned bots whose app speaks AG-UI, is enabled, and may post.

    The enabled-and-scoped filter is the same one the bot API and the delivery drain
    apply. An app that was disabled or had `messages:write` revoked must not keep
    answering because a mention reached a queue first.
    """
    if not mention_user_ids:
        return []
    rows = (
        await session.execute(
            text(
                f"""
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
                       p.runtime, s.signing_secret
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   -- An address, or a connection it opened itself. A socket agent has no
                   -- agui_url, so the URL test alone would filter out every one of them.
                   AND {MENTIONABLE_AGENT}
                   AND u.id = ANY(cast(:ids AS uuid[]))
                   AND u.deactivated_at IS NULL
                   AND EXISTS (
                     SELECT 1 FROM plugin_grants g
                      WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
                """
            ),
            {"ws": workspace_id, "ids": mention_user_ids},
        )
    ).fetchall()
    return [
        Listener(
            plugin_id=row.id,
            slug=row.slug,
            name=row.name,
            bot_user_id=row.bot_user_id,
            agui_url=row.agui_url,
            signing_secret=row.signing_secret,
            runtime=row.runtime,
        )
        for row in rows
    ]


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
    """
    row = (
        await session.execute(
            text(
                f"""
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
                       p.runtime, s.signing_secret
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
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
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   -- It can be reached at all. Neither flag below implies it:
                   -- `set_owner` will hand *any* installed app to a person, so without
                   -- this a request_url-only app given to somebody makes their DM with
                   -- it answer, every plain line, with "that agent has no endpoint to
                   -- call" — see `plugins/streams`.
                   AND {MENTIONABLE_AGENT}
                   -- The room is the address for a resident agent, and for the
                   -- person's own agent. Never for an app installed by hand.
                   AND (p.answers_dm_without_mention OR p.owner_user_id = other.id)
                   AND u.deactivated_at IS NULL
                   AND EXISTS (
                     SELECT 1 FROM plugin_grants g
                      WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
                   -- Two members and no more. `kind` cannot be trusted for this.
                   AND (SELECT count(*) FROM channel_members m
                         WHERE m.channel_id = c.id) = 2
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id},
        )
    ).fetchone()
    if row is None:
        return None
    return Listener(
        plugin_id=row.id,
        slug=row.slug,
        name=row.name,
        bot_user_id=row.bot_user_id,
        agui_url=row.agui_url,
        signing_secret=row.signing_secret,
        runtime=row.runtime,
    )


async def _is_private_room_with(
    session: AsyncSession, *, channel_id: str, user_id: str, bot_user_id: str
) -> bool:
    """Is this channel a DM holding exactly this person and this agent?

    `kind` alone cannot answer it: a DM's kind is set from the member count when it is
    created and never re-derived, while `app_join_channel` can add a bot to a channel
    with no kind test at all — so a `kind='dm'` row can hold three members. The count is
    checked in the statement for the same reason `personal_agent_for` checks it there.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT 1 FROM channels c
                 WHERE c.id = :channel_id
                   AND c.kind = 'dm'
                   AND EXISTS (SELECT 1 FROM channel_members m
                                WHERE m.channel_id = c.id AND m.user_id = :user_id)
                   AND EXISTS (SELECT 1 FROM channel_members m
                                WHERE m.channel_id = c.id AND m.user_id = :bot_user_id)
                   AND (SELECT count(*) FROM channel_members m
                         WHERE m.channel_id = c.id) = 2
                """
            ),
            {"channel_id": channel_id, "user_id": user_id, "bot_user_id": bot_user_id},
        )
    ).fetchone()
    return row is not None


@asynccontextmanager
async def looks_busy(
    listener: Listener, channel_id: str, thread_root_id: str | None
) -> AsyncIterator[None]:
    """Show the agent typing for as long as it is thinking.

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
