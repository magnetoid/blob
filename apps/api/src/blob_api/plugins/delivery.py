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
* **Five consecutive terminal failures open the circuit.** The plugin is parked as
  `failed` so later events wait rather than burning the backoff ladder. An admin
  re-enables it.
* **A failing app is not a failing workspace.** Every error is contained here; nothing in
  this module can raise into a send.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib.errors import bad_request, not_found
from ..lib.ids import looks_like_id
from ..services import policies as policy_service
from . import egress, recent_errors
from .signing import signed_headers

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

#: Consecutive terminal failures (failed or dead) that park the plugin. A delivered
#: event in the last five resets the streak.
CIRCUIT_FAILURES = 5
CIRCUIT_ERROR = "Circuit open: too many delivery failures."


def backoff_for(attempts: int, *, jitter: float | None = None) -> float | None:
    """Delay before the next attempt, or None when there should not be one."""
    if attempts < 1 or attempts > len(BACKOFF_SEC):
        return None
    base = BACKOFF_SEC[attempts - 1]
    spread = random.uniform(0, JITTER) if jitter is None else jitter  # noqa: S311 — retry jitter, not cryptography
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
                              p.request_url, s.signing_secret, p.workspace_id, p.runtime
                    """
                ),
                {"limit": limit, "lease": LEASE_SEC},
            )
        ).fetchall()
    return list(rows)


async def post(
    url: str,
    secret: str,
    payload: dict[str, Any],
    delivery_id: str,
    *,
    trusted_address: bool = False,
) -> tuple[int, str]:
    """POST one signed delivery. Returns (status code, error text); 0 means no response.

    Checked as it is sent and sent to the address that was checked (`egress`), unless the
    address is one Blob does not judge; refused, it is a failed attempt like any other."""
    goal = await egress.target(url, trusted_address=trusted_address)
    if goal is None:
        return 0, f"Not sent: {egress.REFUSED}."
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = {
        **signed_headers(secret, body),
        # Apps dedupe on this: a retry after a timeout carries the same id as the
        # attempt that may in fact have succeeded.
        "x-blob-delivery-id": delivery_id,
        "user-agent": "blob-plugins/1.0",
    }
    try:
        response = await open_client().post(
            goal.url,
            content=body,
            headers={**headers, **goal.headers},
            extensions=goal.extensions,
        )
        return response.status_code, response.text[:500]
    except httpx.HTTPError as exc:
        return 0, str(exc)[:500]


_client: httpx.AsyncClient | None = None


def open_client() -> httpx.AsyncClient:
    """The one connection pool every delivery shares.

    A client per delivery meant a TLS handshake per delivery — a backlog of fifty to
    the same app was fifty handshakes. Owned by this module so tests patch a name it
    controls rather than reaching into httpx.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC, follow_redirects=False)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def _record(
    session: AsyncSession,
    delivery_id: str,
    status_code: int,
    error: str,
    attempts: int,
    plugin_id: str,
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
        await trip_if_open(session, plugin_id)
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
        await trip_if_open(session, plugin_id)
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


async def trip_if_open(session: AsyncSession, plugin_id: str) -> None:
    """Park the plugin when the last few deliveries all failed.

    Disabling it is what pauses the queue — `lease_due` already skips anything that is
    not enabled — so later events wait instead of spending the backoff ladder on an
    app that has been down for a while. An admin turning it back on is the reset.
    """
    recent = (
        await session.execute(
            text(
                """
                SELECT status FROM plugin_deliveries
                 WHERE plugin_id = :pid AND status IN ('delivered', 'failed', 'dead')
                 ORDER BY id DESC
                 LIMIT :n
                """
            ),
            {"pid": plugin_id, "n": CIRCUIT_FAILURES},
        )
    ).fetchall()
    if len(recent) < CIRCUIT_FAILURES or any(row.status == "delivered" for row in recent):
        return
    await session.execute(
        text(
            f"""
            UPDATE plugins
               SET status = 'failed', {recent_errors.record_sql("err")}, updated_at = now()
             WHERE id = :id AND status = 'enabled'
            """
        ),
        {"id": plugin_id, "err": CIRCUIT_ERROR},
    )


async def record_result(
    delivery_id: str, status_code: int, error: str, attempts: int, plugin_id: str
) -> None:
    async with transaction() as (session, _after):
        await _record(session, delivery_id, status_code, error, attempts, plugin_id)


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
    # Whether each workspace may reach private addresses, read once for the batch.
    private_ok: dict[str, bool] = {}
    async with session_scope() as session:
        for workspace_id in {str(row.workspace_id) for row in due}:
            policy = await policy_service.effective_for(session, workspace_id)
            private_ok[workspace_id] = policy.may_use_private_endpoints

    async def deliver_group(rows: list[Any]) -> None:
        for row in rows:
            code, error = await post(
                row.request_url,
                row.signing_secret,
                row.payload,
                row.id,
                trusted_address=egress.trusted(
                    row.request_url,
                    runtime=row.runtime,
                    private_ok=private_ok[str(row.workspace_id)],
                ),
            )
            await record_result(row.id, code, error, row.attempts, row.plugin_id)

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


# --------------------------------------------------------------------------------------
# The delivery log, as the console reads it (`routers/plugin_logs.py`): the outbox above
# is what it lists, and a replay puts a row back in it. Moved here from
# `plugins/registry.py` in phase 8 of the agentic review.
# --------------------------------------------------------------------------------------


DELIVERY_COLUMNS = (
    "id, event, status, attempts, last_status_code, last_error,"
    " created_at, delivered_at, next_attempt_at"
)


async def deliveries(session: AsyncSession, plugin_id: str, *, limit: int) -> list[Any]:
    """The delivery log — the first place to look when an app says it heard nothing."""
    return list(
        (
            await session.execute(
                text(
                    f"""
                    SELECT {DELIVERY_COLUMNS}
                      FROM plugin_deliveries
                     WHERE plugin_id = :id
                     ORDER BY id DESC
                     LIMIT :limit
                    """
                ),
                {"id": plugin_id, "limit": limit},
            )
        ).fetchall()
    )


async def delivery(session: AsyncSession, plugin_id: str, delivery_id: str) -> Any:
    """One delivery in full, including the payload the app was sent."""
    row = (
        await session.execute(
            text(
                f"""
                SELECT {DELIVERY_COLUMNS}, payload, channel_id
                  FROM plugin_deliveries
                 WHERE id = :id AND plugin_id = :plugin_id
                """
            ),
            {"id": delivery_id, "plugin_id": plugin_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("That delivery is not in this app's log.")
    return row


def room_of(row: Any) -> str | None:
    """The conversation a delivery came from: the column, or for a row written before it
    existed, the id its payload names."""
    if row.channel_id:
        return str(row.channel_id)
    body = row.payload.get("payload") if isinstance(row.payload, dict) else None
    if not isinstance(body, dict):
        return None
    for key in ("channelId", "channel_id", "channel"):
        value = body.get(key)
        if isinstance(value, dict):
            value = value.get("id")
        if isinstance(value, str) and looks_like_id(value):
            return value
    return None


async def room_visible(session: AsyncSession, viewer_id: str, channel_id: str) -> bool:
    """Whether this admin can see the conversation — the rule a run's events follow: a
    public channel to anyone here but a guest, anything else to its members."""
    row = (
        await session.execute(
            text(
                """
                SELECT (c.kind = 'public' AND NOT EXISTS (
                          SELECT 1 FROM users viewer
                           WHERE viewer.id = :viewer AND viewer.role = 'guest'))
                       OR EXISTS (
                          SELECT 1 FROM channel_members cm
                           WHERE cm.channel_id = c.id AND cm.user_id = :viewer
                       ) AS visible
                  FROM channels c
                 WHERE c.id = :channel
                """
            ),
            {"viewer": viewer_id, "channel": channel_id},
        )
    ).fetchone()
    return bool(row and row.visible)


async def replay_delivery(session: AsyncSession, plugin_id: str, delivery_id: str) -> Any:
    """Put a failed or dead delivery back in the queue, as if it had never been tried."""
    row = (
        await session.execute(
            text(
                f"""
                UPDATE plugin_deliveries
                   SET status = 'pending', attempts = 0, next_attempt_at = now(),
                       last_error = NULL, last_status_code = NULL, delivered_at = NULL
                 WHERE id = :id AND plugin_id = :plugin_id
                   AND status IN ('failed', 'dead')
                RETURNING {DELIVERY_COLUMNS}
                """
            ),
            {"id": delivery_id, "plugin_id": plugin_id},
        )
    ).fetchone()
    if row is not None:
        return row
    existing = (
        await session.execute(
            text("SELECT id FROM plugin_deliveries WHERE id = :id AND plugin_id = :plugin_id"),
            {"id": delivery_id, "plugin_id": plugin_id},
        )
    ).fetchone()
    if existing is None:
        raise not_found("That delivery is not in this app's log.")
    raise bad_request("Only a failed or dead delivery can be replayed.", code="not_replayable")
