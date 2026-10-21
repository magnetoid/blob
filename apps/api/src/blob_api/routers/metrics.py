"""`GET /metrics`: what agents and Blob's tools have done, in Prometheus's text format.

Behind a bearer token, `METRICS_TOKEN`, because the numbers name every agent on the server
and say how busy each one is. Unset, the route answers 404 as though it were not there: a
scrape endpoint nobody configured has no reason to announce itself.

The counters are shared by every process through Redis (`lib/metrics.py`); the gauges are
read at the moment of the scrape — runs going now and questions waiting from the database,
open sockets and database connections from what each API process last reported, and the
queue's depth from arq's own sorted set. Not in the OpenAPI document: it is for a scraper,
not for the client.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Request, Response

from ..config import settings
from ..db.engine import session_scope
from ..lib import metrics
from ..lib.errors import not_found
from ..lib.redis import redis
from ..services import agent_runs as agent_run_service

log = logging.getLogger("blob.metrics")

router = APIRouter(tags=["metrics"], include_in_schema=False)

#: The exposition format's own media type, which a Prometheus scrape asks for.
CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def _presented(request: Request) -> str:
    header = request.headers.get("authorization", "")
    prefix = "bearer "
    return header[len(prefix) :].strip() if header[: len(prefix)].lower() == prefix else ""


async def _server_gauges() -> list[tuple[metrics.Family, dict[str, str], float]]:
    """Sockets and database connections over every API process, and the queue's depth."""
    summed = await metrics.processes()
    queued = await redis.zcard("arq:queue")
    return [
        (metrics.WEBSOCKETS, {}, summed.get("websockets", 0)),
        (metrics.DB_CONNECTIONS, {"state": "in_use"}, summed.get("db_in_use", 0)),
        (metrics.DB_CONNECTIONS, {"state": "idle"}, summed.get("db_idle", 0)),
        (metrics.QUEUE_DEPTH, {}, queued),
    ]


@router.get("/metrics")
async def scrape(request: Request) -> Response:
    expected = (settings.METRICS_TOKEN or "").strip()
    if not expected:
        raise not_found("Not found.")
    presented = _presented(request)
    if not presented or not hmac.compare_digest(presented.encode(), expected.encode()):
        return Response(
            "A metrics token is required.\n",
            status_code=401,
            media_type="text/plain",
            headers={"WWW-Authenticate": 'Bearer realm="metrics"'},
        )
    async with session_scope() as session:
        live = await agent_run_service.live_counts(session)
    gauges = {metrics.IN_FLIGHT: live.running, metrics.WAITING: live.waiting}
    try:
        body = await metrics.render(gauges, await _server_gauges())
    except Exception:
        # Counters that cannot be read are said to be unreadable: an empty answer would
        # graph as every agent having stopped at once.
        log.warning("could not read the counters for a scrape", exc_info=True)
        return Response("The counters are unavailable.\n", status_code=503, media_type="text/plain")
    return Response(body, media_type=CONTENT_TYPE)
