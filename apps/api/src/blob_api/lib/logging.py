"""JSON-ish logs with a request id, so a 500 is greppable across processes.

stdlib logging, not a new dependency. Production is one JSON object per line; everywhere
else is the same fields in a line a human can read. The request id lives in a ContextVar
so a worker thread the request hopped onto still has it, and so a log from a dependency
that never saw the Request still can.
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..config import settings

request_id_var: ContextVar[str] = ContextVar("blob_request_id", default="-")


def current_request_id() -> str:
    return request_id_var.get()


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current_request_id()  # type: ignore[attr-defined]
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class RequestIdMiddleware:
    """Stamp every HTTP response with `X-Request-ID`, and bind it for the loggers.

    Honours an incoming `X-Request-ID` so a proxy that already minted one keeps a single
    id across hops. Generates one otherwise. WebSocket upgrades skip the response header
    (there is no HTTP response to write it on after the handshake) but still bind the var
    so frames logged during the connection carry it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        incoming = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        rid = incoming.get("x-request-id") or str(uuid.uuid4())
        token = request_id_var.set(rid)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id if scope["type"] == "http" else send)
        finally:
            request_id_var.reset(token)


_configured = False


def configure() -> None:
    """Install once. Tests import the app repeatedly; a second call must be a no-op."""
    global _configured
    if _configured:
        return
    # Filter on the root so caplog, uvicorn and the worker all see `request_id`.
    logging.getLogger().addFilter(RequestIdFilter())
    if settings.is_prod:
        handler = logging.StreamHandler(sys.stderr)
        handler.addFilter(RequestIdFilter())
        handler.setFormatter(JsonFormatter())
        blob = logging.getLogger("blob")
        blob.addHandler(handler)
        blob.setLevel(logging.INFO)
        blob.propagate = False
    _configured = True
