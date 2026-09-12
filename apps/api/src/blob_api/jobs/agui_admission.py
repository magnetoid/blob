"""Who answers a mention, and with what.

The admission half of `jobs/agui.py`: which bots a message reached and may run
(`listeners_for`), whether a DM is one person's private room with the built-in agent
(`personal_agent_for`), which tools an agent may hold and on whose authority
(`agent_tools`), and the typing indicator a run shows while it thinks (`looks_busy`).
None of this contacts an agent; all of it decides whether and how one is contacted.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope
from ..lib import llm
from ..lib.errors import AppError
from ..plugins import builtin
from ..plugins.registry import MENTIONABLE_AGENT
from ..plugins.streams import Listener
from ..realtime import presence
from ..realtime.protocol import TYPING_TTL_MS
from ..services import mcp as mcp_service

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
                       p.runtime, s.signing_secret, w.name AS workspace_name
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                  JOIN workspaces w ON w.id = p.workspace_id
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   -- An address, a connection it opened itself, or no network at all.
                   -- A socket agent has no agui_url and the built-in agent has neither
                   -- end, so the URL test alone would filter out every one of both.
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
            workspace_name=row.workspace_name,
        )
        for row in rows
    ]


async def personal_agent_for(
    session: AsyncSession, *, workspace_id: str, channel_id: str
) -> Listener | None:
    """The built-in agent, if this channel is one person's private room with it.

    A DM with the agent needs no `@Blob`, because there is nobody else it could be
    addressed to — which is the whole reason a personal agent works without a second
    identity, a second bot, or a row anywhere. The room is what makes it personal.

    **Every condition is in the statement, and none of them is `kind` alone.** `kind` is
    set from the member count when a DM is created and never re-derived, while
    `app_join_channel` can add a bot to a channel with no kind test at all — so a
    `kind='dm'` row can hold three members, and a design that trusted the label would put
    a model told "this is your private room with Ada" into a room Bo is also reading. The
    count is therefore checked directly, in the same query as everything else.

    Scoped to `runtime = 'builtin'` deliberately. Widening the trigger to "any bot in a
    DM" would hand every installed third-party app a run for every line typed at it, with
    no manifest opt-in and no way for its author to decline — a change to somebody else's
    contract, smuggled in as a convenience.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT p.id, p.slug, p.name, u.id AS bot_user_id, p.agui_url,
                       p.runtime, s.signing_secret, w.name AS workspace_name,
                       other.display_name AS owner_name
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                  JOIN plugin_secrets s ON s.plugin_id = p.id
                  JOIN workspaces w ON w.id = p.workspace_id
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
                   AND p.runtime = :runtime
                   AND u.deactivated_at IS NULL
                   AND EXISTS (
                     SELECT 1 FROM plugin_grants g
                      WHERE g.plugin_id = p.id AND g.scope = 'messages:write')
                   -- Two members and no more. `kind` cannot be trusted for this.
                   AND (SELECT count(*) FROM channel_members m
                         WHERE m.channel_id = c.id) = 2
                """
            ),
            {"ws": workspace_id, "channel_id": channel_id, "runtime": builtin.RUNTIME},
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
        workspace_name=row.workspace_name,
        owner_name=row.owner_name,
    )


async def agent_tools(
    listener: Listener, *, workspace_id: str, user_id: str
) -> tuple[list[dict[str, Any]], llm.ToolRunner | None]:
    """The tools this agent may use, and a runner that runs them as the person who asked.

    Two decisions live here rather than in the agent, because both are about authority and
    the agent is the last place that should hold an opinion about its own.

    **Whose eyes.** The caller is built from `initiated_by_user_id` — the person who
    rooted the chain, never the agent and never the last speaker in it (ADR 0013). An
    agent reached through somebody else's hop therefore reads what *that* person can read
    and no more, so a private channel answers the agent exactly as it answers them, and
    the blast radius of a prompt injection stops at the asker's own membership.

    **Which tools.** `plugin_grants`, the same rows the console shows and an admin
    revokes. No grant, no tool — and the tool is absent from the schema list rather than
    refused at call time, because a model offered something it may not use will use it and
    the person reads a permission error in the middle of an answer.

    A refusal comes back as the tool's result, not as an exception: "I could not see that"
    is an answer the model can write a sentence about, while a raised error would end the
    run and tell the person nothing about what was asked for.
    """
    if not listener.runs_here or not user_id:
        return [], None
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT u.display_name, w.name AS workspace_name,
                           coalesce(
                             (SELECT array_agg(g.scope)
                                FROM plugin_grants g
                               WHERE g.plugin_id = :plugin_id),
                             '{}'
                           ) AS scopes
                      FROM users u
                      JOIN workspaces w ON w.id = :ws
                     WHERE u.id = :user_id
                       AND u.workspace_id = :ws
                       AND u.deactivated_at IS NULL
                    """
                ),
                {"plugin_id": listener.plugin_id, "ws": workspace_id, "user_id": user_id},
            )
        ).fetchone()
    if row is None:
        return [], None
    granted = frozenset(row.scopes or ())
    tools = mcp_service.tools_for_agent(granted)
    if not tools:
        return [], None
    caller = mcp_service.McpCaller(
        token_id="",
        token_name=listener.name,
        user_id=user_id,
        workspace_id=workspace_id,
        display_name=row.display_name,
        workspace_name=row.workspace_name,
        # Write only when an admin turned it on. `tools_for_agent` has already filtered
        # `post_message` out of the schema without the grant, and this is the other half:
        # the two must agree, or the model is offered a tool the dispatcher then refuses.
        scopes=frozenset({"read", "write"})
        if "messages:write.anywhere" in granted
        else frozenset({"read"}),
        # Never, for any agent. A person typing `@Planner do this` meant to start
        # something; a model repeating a name it read did not, and ADR 0013 bounds chains
        # by making a person's message the only thing that roots one.
        may_start_runs=False,
    )

    async def run(name: str, arguments: dict[str, Any]) -> str:
        try:
            return await mcp_service.call(caller, name, arguments)
        except AppError as error:
            return f"That did not work: {error.message}"

    return tools, run


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
