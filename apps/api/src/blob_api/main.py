"""HTTP + WebSocket server."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import settings
from .db.engine import SessionFactory, close_engine
from .lib.auth import SESSION_COOKIE, resolve_session
from .lib.errors import AppError
from .lib.logbuf import close_log_buffer, install_log_capture
from .lib.redis import close_redis, redis
from .realtime import hub
from .services import workspace_agent
from .web import mount_web

log = logging.getLogger("blob")

#: Routes reachable without a session. Everything else under /api requires one.
PUBLIC_ROUTES: set[tuple[str, str]] = {
    ("GET", "/healthz"),
    ("GET", "/readyz"),
    ("GET", "/api/auth/state"),
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
}

#: Prefixes whose whole subtree is public (invite previews, incoming webhooks).
#:
#: `/api/v1/` is the app callback API: it authenticates with a bot token rather than a
#: session cookie, so it must bypass the cookie check — and it enforces its own auth on
#: every route through the `current_bot` dependency, never falling back to "no user".
PUBLIC_PREFIXES = ("/api/invites/", "/api/hooks/", "/api/v1/")


def _error(status: int, code: str, message: str, field: str | None = None) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if field:
        body["field"] = field
    return JSONResponse({"error": body}, status_code=status)


def is_allowed_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
        allowed = urlparse(settings.PUBLIC_URL)
        if parsed.netloc == allowed.netloc:
            return True
        # Vite's dev server runs on a different port than the API.
        return not settings.is_prod and parsed.hostname == "localhost"
    except ValueError:
        return False


class SessionMiddleware:
    """Resolves the session cookie once per request and enforces the public allowlist.

    Written as pure ASGI rather than BaseHTTPMiddleware, which interferes with streaming
    responses and background tasks.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        # HTTPConnection covers both http and websocket scopes; Request asserts http.
        connection = HTTPConnection(scope)
        token = connection.cookies.get(SESSION_COOKIE)
        user = await resolve_session(token) if token else None
        scope.setdefault("state", {})["user"] = user

        if scope["type"] == "websocket":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        path = request.url.path
        method = request.method
        is_public = (method, path) in PUBLIC_ROUTES or path.startswith(PUBLIC_PREFIXES)

        if not is_public and path.startswith("/api/") and user is None:
            response = _error(401, "unauthorized", "Sign in to continue.")
            await response(scope, receive, send)
            return

        # Cookies are SameSite=Lax, but check Origin too on state-changing requests.
        if method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and not is_allowed_origin(origin):
                response = _error(403, "forbidden", "Blocked request.")
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await hub.start_redis_bridge()
    # Every workspace that has no built-in agent gets one, which is a no-op on all but
    # the first boot after a model is configured. It lives here because `LLM_PROVIDER`
    # arrives as an environment variable, so the moment it changes *is* a restart —
    # putting the reconcile anywhere else would mean a server that has been running for a
    # month gains the feature for new workspaces and not for the ones already using it.
    # It never raises: a workspace that cannot seed its agent must not stop the boot.
    try:
        seeded = await workspace_agent.ensure_everywhere()
        if seeded:
            log.info("seeded the built-in agent into %d workspace(s)", seeded)
    except Exception:
        log.exception("could not reconcile built-in agents")
    yield
    await hub.stop_redis_bridge()
    await close_log_buffer()
    await close_redis()
    await close_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Blob",
        version="0.1.0",
        lifespan=lifespan,
        separate_input_output_schemas=False,
    )

    app.add_middleware(SessionMiddleware)

    # Warnings and errors are copied into a capped Redis list so the instance console can
    # show them. Installed here rather than in `lifespan`, so a failure during startup —
    # the kind hardest to see from outside — is already being captured.
    install_log_capture()

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _error(exc.status_code, exc.code, exc.message, exc.field)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI would return 422; the client contract says 400 invalid_input.
        first = exc.errors()[0] if exc.errors() else {}
        location = [
            str(part)
            for part in first.get("loc", ())
            if part not in ("body", "query", "path", "cookie", "header")
        ]
        return _error(
            400,
            "invalid_input",
            first.get("msg", "That input is not valid."),
            ".".join(location) or None,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "bad_request"
        detail = exc.detail if isinstance(exc.detail, str) else "That request is not valid."
        return _error(exc.status_code, code, detail)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # The extras are what let the console say *which* endpoint blew up rather than
        # only that something did; `logbuf` reads them off the record.
        log.exception(
            "unhandled error on %s %s",
            request.method,
            request.url.path,
            extra={"request_path": request.url.path, "request_method": request.method},
        )
        return _error(500, "internal", "Something went wrong on our side.")

    @app.get("/healthz")
    async def healthz() -> dict[str, Any]:
        """Liveness: is this process answering?

        Deliberately touches nothing. It is what the container health check calls, and a
        check that queried Postgres would restart a healthy app every time the database
        blinked — exactly when restarting helps least. It also used to report live socket
        counts, which is not something to publish on a public URL; the authenticated
        /api/admin/health carries those.
        """
        return {"ok": True}

    @app.get("/readyz")
    async def readyz() -> dict[str, Any]:
        """Readiness: can this process serve? Used as the gate on a deploy."""
        async with SessionFactory() as session:
            await session.execute(text("SELECT 1"))
        await redis.ping()
        return {"ok": True}

    from .realtime.ws import router as ws_router
    from .routers.admin import router as admin_router
    from .routers.agent_socket import router as agent_socket_router
    from .routers.agentic import router as agentic_router
    from .routers.auth import router as auth_router
    from .routers.bot_api import router as bot_api_router
    from .routers.channels import router as channel_router
    from .routers.commands import router as command_router
    from .routers.feedback import router as feedback_router
    from .routers.files import router as file_router
    from .routers.groups import member_router as group_member_router
    from .routers.groups import router as group_router
    from .routers.interactions import router as interaction_router
    from .routers.messages import router as message_router
    from .routers.plugins import router as plugin_router
    from .routers.search import router as search_router
    from .routers.themes import router as theme_router
    from .routers.users import router as user_router
    from .routers.workspaces import router as workspace_router

    app.include_router(auth_router)
    app.include_router(user_router)
    app.include_router(workspace_router)
    app.include_router(channel_router)
    app.include_router(message_router)
    app.include_router(command_router)
    app.include_router(agentic_router)
    app.include_router(search_router)
    app.include_router(file_router)
    app.include_router(feedback_router)
    app.include_router(interaction_router)
    app.include_router(admin_router)
    app.include_router(group_router)
    app.include_router(group_member_router)
    app.include_router(theme_router)
    app.include_router(plugin_router)
    app.include_router(bot_api_router)
    app.include_router(ws_router)
    app.include_router(agent_socket_router)

    # Last, so every route above answers first: a mount at "/" matches anything.
    if settings.WEB_DIST and not mount_web(app, settings.WEB_DIST):
        log.warning("WEB_DIST=%s has no index.html; serving the API only", settings.WEB_DIST)

    return app


app = create_app()
