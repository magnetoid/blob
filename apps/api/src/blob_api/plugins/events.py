"""Emitting events to plugins.

A transactional outbox. `emit` writes one `plugin_deliveries` row per subscribed plugin
*inside the caller's transaction*, so a delivered event always corresponds to a committed
row — and an event is never lost because the process died between COMMIT and the HTTP
call. The worker drains the table separately.

That ordering is the whole design. The alternative, firing an HTTP request from the
request handler, gets both halves wrong: it can deliver an event for a transaction that
later rolls back, and it loses events whenever the process restarts at the wrong moment.

Observers only. Nothing here can block or alter a message — the one blocking hook in the
plan (`message.before_create`) is local-runtime work and deliberately absent from the
external path, where a slow HTTP call would sit in the middle of every send.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id

log = logging.getLogger("blob.plugins")

#: Events that happen somewhere in particular. Each of these must be emitted with the
#: channel it happened in, because who may hear it depends on who can see that channel.
#: Listed explicitly and enforced below, so adding a channel-scoped event without
#: scoping it fails immediately rather than quietly delivering private conversation to
#: every installed app.
CHANNEL_SCOPED = frozenset(
    {
        "message.created",
        "message.updated",
        "message.deleted",
        "reaction.added",
        "reaction.removed",
        "member.joined",
        "member.left",
        "thread.summary.updated",
        "interaction.triggered",
    }
)


async def emit(
    session: AsyncSession,
    *,
    workspace_id: str,
    event: str,
    payload: dict[str, Any],
    channel_id: str | None = None,
    exclude_plugin_id: str | None = None,
    only_plugin_id: str | None = None,
) -> list[str]:
    """Queue `event` for every enabled plugin subscribed to it. Returns delivery ids.

    `channel_id` scopes the event to the apps that can see that channel, and anything
    happening in a channel must pass it. A bot reads exactly what a person in its place
    reads: public channels, plus private channels and DMs it was actually invited to.
    Without it an app subscribed to `message.created` was handed the body of every
    message in the workspace — every private channel it had never been invited to, and
    every direct message — while the API it would have used to fetch the same message
    answered 404. The pull side has always been scoped; this is the push side agreeing.

    `exclude_plugin_id` keeps an app from being woken by its own message — without it,
    an app that posts on `message.created` answers itself forever.

    `only_plugin_id` narrows delivery to one app, for an event that belongs to it alone:
    an interaction is a reply to the app whose message published the action, and sending
    it to every subscriber would hand one app the button presses meant for another.
    """
    if event in CHANNEL_SCOPED and channel_id is None:
        # Not a 400 — no request is malformed. This is a programming error, and the
        # failure it prevents is silent disclosure, so it is worth stopping the send.
        raise ValueError(
            f"{event} happens in a channel and must be emitted with channel_id, "
            "or every app would hear it regardless of who can see the channel."
        )

    subscribers = (
        await session.execute(
            text(
                """
                SELECT p.id
                  FROM plugins p
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   -- A container agent is an external app whose hosting we arranged;
                   -- filtering on 'external' alone would deliver it nothing.
                   AND p.runtime IN ('external', 'container')
                   AND :event = ANY(p.events)
                   AND (cast(:exclude AS uuid) IS NULL OR p.id <> cast(:exclude AS uuid))
                   AND (cast(:only AS uuid) IS NULL OR p.id = cast(:only AS uuid))
                   -- The same test `assert_channel_access` applies to a person, against
                   -- the bot's own user row: a public channel is readable by anyone in
                   -- the workspace, anything else takes membership. A plugin with no bot
                   -- user hears nothing from a channel, which is the safe direction.
                   AND (
                     cast(:channel AS uuid) IS NULL
                     OR EXISTS (
                       SELECT 1
                         FROM channels c
                         JOIN users bot ON bot.bot_plugin_id = p.id
                        WHERE c.id = cast(:channel AS uuid)
                          AND c.workspace_id = p.workspace_id
                          AND (
                            c.kind = 'public'
                            OR EXISTS (
                              SELECT 1 FROM channel_members cm
                               WHERE cm.channel_id = c.id AND cm.user_id = bot.id
                            )
                          )
                     )
                   )
                 ORDER BY p.id
                """
            ),
            {
                "ws": workspace_id,
                "event": event,
                "channel": channel_id,
                "exclude": exclude_plugin_id,
                "only": only_plugin_id,
            },
        )
    ).fetchall()
    if not subscribers:
        return []

    body = json.dumps({"event": event, "payload": payload})
    ids: list[str] = []
    for row in subscribers:
        delivery_id = new_id()
        ids.append(delivery_id)
        await session.execute(
            text(
                """
                INSERT INTO plugin_deliveries (id, plugin_id, event, payload)
                VALUES (:id, :plugin_id, :event, cast(:payload AS jsonb))
                """
            ),
            {
                "id": delivery_id,
                "plugin_id": row.id,
                "event": event,
                "payload": body,
            },
        )
    return ids


async def has_subscribers(session: AsyncSession, workspace_id: str, event: str) -> bool:
    """Whether emitting is worth the payload construction on a hot path.

    The runtime filter has to match `emit` exactly. A cheaper-looking answer here that
    disagrees with the query that actually queues deliveries is worse than no shortcut
    at all: it reports "nobody is listening" for a workspace whose only subscriber is a
    container agent, and the events are never built.
    """
    found = (
        await session.execute(
            text(
                """
                SELECT 1 FROM plugins
                 WHERE workspace_id = :ws AND status = 'enabled'
                   AND runtime IN ('external', 'container') AND :event = ANY(events)
                 LIMIT 1
                """
            ),
            {"ws": workspace_id, "event": event},
        )
    ).fetchone()
    return found is not None
