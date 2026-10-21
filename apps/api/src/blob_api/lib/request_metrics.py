"""Every HTTP request counted and timed by its route template, and traced when traces are on.

`/api/messages/{message_id}`, never the path it was asked on: an id would make a series per
message, and a query string carries what people search for. The template is what FastAPI
matched, read off the scope once the request is answered — every middleware here shares
that one scope. Anything no route matched is `unmatched` under `/api`, `/ws`, `/oauth` and
`/.well-known`, and `web` elsewhere (the client's files and the paths it routes itself).

Pure ASGI, like `SessionMiddleware`: `BaseHTTPMiddleware` interferes with streaming. The
numbers go into the process's tally (`lib/metrics.py`), which reaches Redis every few
seconds. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set the request is also a SERVER span named
`{method} {route}`, continuing the caller's trace, with the method, route and status — no
URL, no headers, no body (ADR 0025).
"""

from __future__ import annotations

import time

from opentelemetry.trace import SpanKind
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import metrics, telemetry

#: Methods counted by name; anything else is OTHER, so junk from a scanner makes no series.
METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
#: Prefixes where an unmatched path is a request that went nowhere, not the client's.
SERVER_PREFIXES = ("/api/", "/api", "/ws", "/oauth/", "/.well-known/", "/metrics")


def route_of(scope: Scope) -> str:
    route = scope.get("route")
    template = getattr(route, "path", None)
    if isinstance(template, str) and template:
        return template
    path = str(scope.get("path") or "")
    return "unmatched" if path.startswith(SERVER_PREFIXES) else "web"


class RequestMetricsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = str(scope.get("method") or "GET").upper()
        method = method if method in METHODS else "OTHER"
        status = 500
        started = time.perf_counter()

        async def answered(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
            await send(message)

        if not telemetry.active():
            try:
                await self.app(scope, receive, answered)
            finally:
                self._count(scope, method, status, started)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        with telemetry.span(
            method,
            kind=SpanKind.SERVER,
            attributes={"http.request.method": method},
            parent=telemetry.extract(headers),
        ) as span:
            try:
                await self.app(scope, receive, answered)
            finally:
                route = self._count(scope, method, status, started)
                span.update_name(f"{method} {route}")
                span.set_attribute("http.route", route)
                span.set_attribute("http.response.status_code", status)
                if status >= 500:
                    telemetry.fail(str(status), span)

    @staticmethod
    def _count(scope: Scope, method: str, status: int, started: float) -> str:
        route = route_of(scope)
        metrics.tally.count(
            metrics.HTTP_REQUESTS, {"method": method, "route": route, "status": str(status)}
        )
        metrics.tally.observe(
            metrics.HTTP_SECONDS,
            {"method": method, "route": route},
            time.perf_counter() - started,
        )
        return route
