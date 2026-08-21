"""Draining the outbox.

Runs in the worker, never in a request. One request in flight per plugin: at this scale
ordering is worth more than throughput, and an app that receives `message.created` after
`message.deleted` for the same message has to reason about a world that never happened.

Failure handling, in order of how much it matters:

* **410 Gone stops permanently.** It is the one status that means "stop sending", and an
  app that has been uninstalled on its own side should be able to say so once instead of
  refusing 200 deliveries.
* **Retries back off** 1s → 5s → 30s → 5m → 30m, then the delivery is dead. Jitter keeps
  a fleet of deliveries that failed together from retrying together.
* **A failing app is not a failing workspace.** Every error is contained here; nothing in
  this module can raise into a send.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import transaction
from .signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign

log = logging.getLogger("blob.plugins.delivery")

#: Seconds to wait before attempt n+1. Past the end of this list, a delivery is dead.
BACKOFF_SEC = (1, 5, 30, 300, 1800)

#: Jitter as a fraction of the delay, so simultaneous failures do not retry in lockstep.
JITTER = 0.2

REQUEST_TIMEOUT_SEC = 10.0

#: How long a leased delivery is held before another worker may retry it. Comfortably
#: longer than the request timeout, so a slow app is not delivered to twice.
LEASE_SEC = 90

#: How many due deliveries one drain handles. Bounded so a backlog is worked through in
#: several passes rather than one very long transaction.
BATCH = 50


def backoff_for(attempts: int, *, jitter: float | None = None) -> float | None:
    """Delay before the next attempt, or None when there should not be one."""
    if attempts < 1 or attempts > len(BACKOFF_SEC):
        return None
    base = BACKOFF_SEC[attempts - 1]
    spread = random.uniform(0, JITTER) if jitter is None else jitter
    return base * (1 + spread)


async def lease_due(limit: int = BATCH) -> list[Any]:
    """Take a batch of due deliveries and push their next attempt out.

    A *lease* rather than a lock held across the HTTP calls. Holding a transaction open
    while POSTing to someone else's server means a slow app keeps a Postgres transaction
    alive for as long as it feels like, which blocks vacuum and eventually everything
    else. Instead the row is stamped and committed immediately; if this worker dies
    mid-flight the lease simply expires and the delivery is retried, which is the same
    thing that happens when a request times out.

    SKIP LOCKED is what makes two workers safe: each takes rows the other has not,
    instead of both queuing behind the same head of the line. Deliveries whose plugin is
    not enabled are not leased at all, so disabling an app pauses its queue rather than
    burning its retries.

    A plugin with no `request_url` yet gets the same pause. A container agent has a row
    before the runner has assigned it a hostname, and leasing those rows would spend the
    whole backoff ladder posting to nowhere before the agent ever finishes deploying.
    """
    async with transaction() as (session, _after):
        rows = (
            await session.execute(
                text(
                    """
                    WITH due AS (
                        SELECT d.id
                          FROM plugin_deliveries d
                          JOIN plugins p ON p.id = d.plugin_id
                         WHERE d.status = 'pending'
                           AND d.next_attempt_at <= now()
                           AND p.status = 'enabled'
                           -- Must agree with the subscriber filter in events.emit: a
                           -- container agent is an external app whose hosting we
                           -- arranged, and leaving it out here queues its events
                           -- forever without ever delivering one.
                           AND p.runtime IN ('external', 'container')
                           AND p.request_url IS NOT NULL
                         ORDER BY d.id
                         LIMIT :limit
                        FOR UPDATE OF d SKIP LOCKED
                    )
                    UPDATE plugin_deliveries d
                       SET attempts = d.attempts + 1,
                           next_attempt_at = now() + make_interval(secs => :lease)
                      FROM due, plugins p, plugin_secrets s
                     WHERE d.id = due.id
                       AND p.id = d.plugin_id
                       AND s.plugin_id = d.plugin_id
                    RETURNING d.id, d.plugin_id, d.event, d.payload, d.attempts,
                              p.request_url, s.signing_secret
                    """
                ),
                {"limit": limit, "lease": LEASE_SEC},
            )
        ).fetchall()
    return list(rows)


async def post(url: str, secret: str, payload: dict[str, Any], delivery_id: str) -> tuple[int, str]:
    """POST one signed delivery. Returns (status code, error text); 0 means no response."""
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: sign(secret, timestamp, body),
        # Apps dedupe on this: a retry after a timeout carries the same id as the
        # attempt that may in fact have succeeded.
        "x-blob-delivery-id": delivery_id,
        "user-agent": "blob-plugins/1.0",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC, follow_redirects=False) as client:
            response = await client.post(url, content=body, headers=headers)
            return response.status_code, response.text[:500]
    except httpx.HTTPError as exc:
        return 0, str(exc)[:500]


async def _record(
    session: AsyncSession, delivery_id: str, status_code: int, error: str, attempts: int
) -> None:
    if 200 <= status_code < 300:
        await session.execute(
            text(
                """
                UPDATE plugin_deliveries
                   SET status = 'delivered', delivered_at = now(), attempts = :attempts,
                       last_status_code = :code, last_error = NULL
                 WHERE id = :id
                """
            ),
            {"id": delivery_id, "attempts": attempts, "code": status_code},
        )
        return

    if status_code == 410:
        # The app says it is gone. Believe it the first time.
        await session.execute(
            text(
                """
                UPDATE plugin_deliveries
                   SET status = 'dead', attempts = :attempts, last_status_code = :code,
                       last_error = 'The app returned 410 Gone.'
                 WHERE id = :id
                """
            ),
            {"id": delivery_id, "attempts": attempts, "code": status_code},
        )
        return

    delay = backoff_for(attempts)
    if delay is None:
        await session.execute(
            text(
                """
                UPDATE plugin_deliveries
                   SET status = 'failed', attempts = :attempts, last_status_code = :code,
                       last_error = :error
                 WHERE id = :id
                """
            ),
            {"id": delivery_id, "attempts": attempts, "code": status_code or None, "error": error},
        )
        return

    await session.execute(
        text(
            """
            UPDATE plugin_deliveries
               SET attempts = :attempts, last_status_code = :code, last_error = :error,
                   next_attempt_at = now() + make_interval(secs => :delay)
             WHERE id = :id
            """
        ),
        {
            "id": delivery_id,
            "attempts": attempts,
            "code": status_code or None,
            "error": error,
            "delay": delay,
        },
    )


async def record_result(delivery_id: str, status_code: int, error: str, attempts: int) -> None:
    async with transaction() as (session, _after):
        await _record(session, delivery_id, status_code, error, attempts)


async def drain_once(limit: int = BATCH) -> int:
    """Deliver everything currently due. Returns how many were attempted."""
    due = await lease_due(limit)
    if not due:
        return 0

    # Grouped by plugin so each app sees its events in order, while different apps are
    # delivered to concurrently. Ordering matters more than throughput here: an app that
    # sees message.deleted before message.created has to reason about a world that never
    # happened.
    by_plugin: dict[str, list[Any]] = {}
    for row in due:
        by_plugin.setdefault(row.plugin_id, []).append(row)

    async def deliver_group(rows: list[Any]) -> None:
        for row in rows:
            code, error = await post(row.request_url, row.signing_secret, row.payload, row.id)
            await record_result(row.id, code, error, row.attempts)

    results = await asyncio.gather(
        *(deliver_group(rows) for rows in by_plugin.values()), return_exceptions=True
    )
    for result in results:
        # A failing app must never be able to stop the drain for every other app.
        if isinstance(result, BaseException):
            log.warning("plugin delivery group failed", exc_info=result)
    return len(due)


async def drain(max_passes: int = 5) -> int:
    """Work through the backlog, stopping when it is empty or the budget is spent."""
    total = 0
    for _ in range(max_passes):
        handled = await drain_once()
        total += handled
        if handled < BATCH:
            break
    return total
