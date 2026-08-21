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


async def emit(
    session: AsyncSession,
    *,
    workspace_id: str,
    event: str,
    payload: dict[str, Any],
    exclude_plugin_id: str | None = None,
    only_plugin_id: str | None = None,
) -> list[str]:
    """Queue `event` for every enabled plugin subscribed to it. Returns delivery ids.

    `exclude_plugin_id` keeps an app from being woken by its own message — without it,
    an app that posts on `message.created` answers itself forever.

    `only_plugin_id` narrows delivery to one app, for an event that belongs to it alone:
    an interaction is a reply to the app whose message published the action, and sending
    it to every subscriber would hand one app the button presses meant for another.
    """
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
                 ORDER BY p.id
                """
            ),
            {
                "ws": workspace_id,
                "event": event,
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
