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
) -> list[str]:
    """Queue `event` for every enabled plugin subscribed to it. Returns delivery ids.

    `exclude_plugin_id` keeps an app from being woken by its own message — without it,
    an app that posts on `message.created` answers itself forever.
    """
    subscribers = (
        await session.execute(
            text(
                """
                SELECT p.id
                  FROM plugins p
                 WHERE p.workspace_id = :ws
                   AND p.status = 'enabled'
                   AND p.runtime = 'external'
                   AND :event = ANY(p.events)
                   AND (cast(:exclude AS uuid) IS NULL OR p.id <> cast(:exclude AS uuid))
                 ORDER BY p.id
                """
            ),
            {"ws": workspace_id, "event": event, "exclude": exclude_plugin_id},
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
    """Whether emitting is worth the payload construction on a hot path."""
    found = (
        await session.execute(
            text(
                """
                SELECT 1 FROM plugins
                 WHERE workspace_id = :ws AND status = 'enabled'
                   AND runtime = 'external' AND :event = ANY(events)
                 LIMIT 1
                """
            ),
            {"ws": workspace_id, "event": event},
        )
    ).fetchone()
    return found is not None
