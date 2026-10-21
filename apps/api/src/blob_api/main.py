"""HTTP + WebSocket server."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import served_commit, settings
from .db.engine import SessionFactory, close_engine, engine
from .lib import metrics, readiness, storage, telemetry
from .lib.auth import resolve_session, session_token
from .lib.body_limit import BodyLimitMiddleware
from .lib.errors import AppError
from .lib.logbuf import close_log_buffer, install_log_capture
from .lib.logging import RequestIdMiddleware
from .lib.logging import configure as configure_logging
from .lib.queue import close_queue
from .lib.redis import close_redis, redis
from .lib.request_metrics import RequestMetricsMiddleware
from .lib.security_headers import SecurityHeadersMiddleware
from .realtime import hub
from .services import janus_agent
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
    # Signing in with a passkey, and the passkey after a password (ADR 0032). Exact pairs:
    # the routes beside them under /api/auth/passkeys add and remove keys.
    ("POST", "/api/auth/passkey/options"),
    ("POST", "/api/auth/passkey/sign-in"),
    ("POST", "/api/auth/two-step"),
    # Single sign-on (ADR 0033): starting a round trip signed out, and the provider sending
    # the browser back. The routes beside them under /api/auth/sso need a session.
    ("POST", "/api/auth/sso/begin"),
    ("GET", "/api/auth/sso/callback"),
    # The MCP endpoint authenticates with its own bearer token, the way `/api/v1/` does.
    # Listed as exact routes rather than as a prefix on purpose: `PUBLIC_PREFIXES` is a
    # `startswith` test, so a `/api/mcp` prefix would also open anything that merely
    # begins with those characters — and the routes next door mint credentials.
    ("POST", "/api/mcp"),
    ("GET", "/api/mcp"),
    ("DELETE", "/api/mcp"),
    # A Prometheus scrape: it presents `METRICS_TOKEN` and the route checks it itself.
    ("GET", "/metrics"),
    # LiveKit's webhooks: signed with our LiveKit key and verified by the route itself.
    ("POST", "/api/calls/livekit"),
    # Stopping away emails from the link in one (ADR 0036): the token in the URL is the
    # authority, and it can do nothing else.
    ("GET", "/api/mail/unsubscribe"),
    ("POST", "/api/mail/unsubscribe"),
}

#: Prefixes whose whole subtree is public (invite previews, incoming webhooks).
#:
#: `/api/v1/` is the app callback API: it authenticates with a bot token rather than a
#: session cookie, so it must bypass the cookie check — and it enforces its own auth on
#: every route through the `current_bot` dependency, never falling back to "no user".
PUBLIC_PREFIXES = ("/api/invites/", "/api/hooks/", "/api/v1/")

#: State-changing routes that read no cookie, and so need no Origin check: an assistant's
#: sign-in (ADR 0029) trades codes and tokens it holds itself, from wherever it runs, and a
#: browser-based client sends its own origin. Outside `/api`, so the session check above
#: never applied to them; listed here so the Origin check below does not either.
ORIGIN_EXEMPT: set[tuple[str, str]] = {
    ("POST", "/oauth/token"),
    ("POST", "/oauth/register"),
    ("POST", "/oauth/revoke"),
    # RFC 8058's one-click POST comes from the mailbox provider's servers, carrying
    # whatever origin they like; the token, not a cookie, is what it presents.
    ("POST", "/api/mail/unsubscribe"),
}


def _error(
    status: int,
    code: str,
    message: str,
    field: str | None = None,
    detail: dict[str, Any] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if field:
        body["field"] = field
    # Omitted unless a code actually carries one, so `{code, message, field?}` stays the
    # shape every existing client branch sees. See `AppError.detail`.
    if detail:
        body["detail"] = detail
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
        token, _plain = session_token(connection.cookies)
        user = await resolve_session(token) if token else None
        scope.setdefault("state", {})["user"] = user

        if scope["type"] == "websocket":
            # A browser sends Origin on every socket handshake, and `SameSite=Lax` does
            # not stop a *same-site* page — a sibling subdomain, which is where hosted
            # agents live — from opening one with the person's cookie attached. Two of
            # the sockets authenticate by that cookie, one of them a root terminal, so a
            # socket from an origin that is not this app is treated as signed out: the
            # same rule the state-changing HTTP requests below get. The agent socket
            # authenticates by its bot token and never reads the session, so it is
            # unaffected; so is any client that sends no Origin at all.
            origin = connection.headers.get("origin")
            if user is not None and origin and not is_allowed_origin(origin):
                scope["state"]["user"] = None
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
        if method not in ("GET", "HEAD", "OPTIONS") and (method, path) not in ORIGIN_EXEMPT:
            origin = request.headers.get("origin")
            if origin and not is_allowed_origin(origin):
                response = _error(403, "forbidden", "Blocked request.")
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Traces, when the environment names an OTLP endpoint; nothing at all otherwise.
    telemetry.configure("api")
    await hub.start_redis_bridge()
    # Every workspace gets Janus when Janus runs as a service in this stack, which is a
    # no-op on all but the first boot after the setting changed. It lives here because
    # that setting arrives as an environment variable, so the moment it changes *is* a
    # restart; put the reconcile anywhere else and a server that has been running for a
    # month gains the agent for new workspaces and not for the ones already using it. The
    # same pass also moves an already-installed agent off a public domain onto the
    # internal address. It never raises — `janus_agent.ensure_everywhere` logs and skips
    # instead — because a workspace that cannot seed its agent must not stop the boot.
    await janus_agent.ensure_everywhere()

    # Said once, at boot, where an operator reading a bad deploy will see it. Uploads go
    # straight from the browser to the bucket, so a storage endpoint this process can
    # reach and a browser cannot is a workspace where every attachment silently fails —
    # and nothing else in the app is in a position to notice.
    try:
        reach = await storage.probe()
        if reach != "ok":
            log.warning(
                "object storage is %s at %s — uploads from a browser will fail. "
                "Set S3_PUBLIC_ENDPOINT to a hostname the browser can reach, on the port "
                "the proxy forwards to the bucket.",
                reach,
                settings.s3_public_endpoint,
            )
    except Exception:
        log.exception("could not check object storage")
    # Requests counted in this process reach the shared counters every few seconds, beside
    # this process's open sockets and database connections (lib/metrics.py).
    flusher = asyncio.create_task(metrics.flush_forever(hub.PROCESS_ID, _process_numbers))
    yield
    flusher.cancel()
    with suppress(asyncio.CancelledError):
        await flusher
    await hub.stop_redis_bridge()
    await close_log_buffer()
    # The arq pool holds a redis connection bound to this loop; leaving it open at
    # shutdown is the loop-bound-client hazard everything else here already avoids.
    await close_queue()
    await close_redis()
    await close_engine()
    telemetry.shutdown()


def _process_numbers() -> dict[str, int]:
    """This process's gauges for `/metrics`: sockets open, connections in use and idle."""
    pool: Any = engine.sync_engine.pool
    try:
        in_use, idle = int(pool.checkedout()), int(pool.checkedin())
    except Exception:
        in_use = idle = 0
    return {"websockets": hub.connection_count(), "db_in_use": in_use, "db_idle": idle}


def create_app() -> FastAPI:
    # No interactive API docs in production. They served the whole surface (186 paths)
    # to anyone, loaded swagger-ui and redoc from a CDN at floating versions onto this
    # origin, and needed a hole in the content security policy to do it. The schema is
    # committed as `packages/shared/openapi.json`; development keeps the pages.
    docs = not settings.is_prod
    app = FastAPI(
        title="Blob",
        version="0.1.0",
        lifespan=lifespan,
        separate_input_output_schemas=False,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )

    app.add_middleware(SessionMiddleware)
    # Outside the session lookup, so an oversized body costs no database round trip, and
    # inside the security headers, so its 413 carries them like every other answer.
    app.add_middleware(BodyLimitMiddleware)
    # Added after, so it wraps SessionMiddleware: the 401 and 403 that middleware writes
    # itself carry the headers too. Starlette applies the last-added middleware outermost.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)
    # Outermost, so a request is timed whole — the session lookup and the body cap with it.
    app.add_middleware(RequestMetricsMiddleware)

    # Warnings and errors are copied into a capped Redis list so the instance console can
    # show them. Installed here rather than in `lifespan`, so a failure during startup —
    # the kind hardest to see from outside — is already being captured.
    configure_logging()
    install_log_capture()

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _error(exc.status_code, exc.code, exc.message, exc.field, exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI would return 422; the client contract says 400 invalid_input.
        first = exc.errors()[0] if exc.errors() else {}
        location = [
            str(part)
            for part in first.get("loc", ())
            if part not in ("body", "query", "path", "cookie", "header")
        ]
        # Pydantic's own wording is the right default — it is specific and it names the
        # constraint. The exception is a failed pattern, whose message is the pattern:
        # `String should match pattern '^[0-9a-fA-F]{8}-...'` is a regex handed to
        # somebody who typed a bad link, and the only patterns here are id shapes.
        message = (
            "That is not a valid id."
            if first.get("type") == "string_pattern_mismatch"
            else first.get("msg", "That input is not valid.")
        )
        return _error(400, "invalid_input", message, ".".join(location) or None)

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
            extra={
                "request_path": request.url.path,
                "request_method": request.method,
                "request_id": request.headers.get("x-request-id"),
            },
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

    @app.get("/readyz", response_model=None)
    async def readyz() -> JSONResponse:
        """Readiness: can this process serve, and which build is it?

        The commit is here for the deploy job. Coolify builds the tip of main rather than
        the commit CI tested, so a green run could ship something else without anybody
        noticing — the job now reads this after it asks for a deploy and fails if the
        commit is not its own. It is not new exposure: `bootstrap.serverCommit` already
        shows the same value to anyone signed in, and the repository is public.

        `checks` adds the three things this used to be blind to (`lib/readiness.py`).
        Only the schema can fail the probe — a process on a schema it was not written for
        cannot serve — so it answers 503 then. The worker and storage are reported and
        never fail it: the app serves without them, and a readiness failure would take
        chat down to say that reminders are late.
        """
        async with SessionFactory() as session:
            applied = set(
                (await session.execute(text("SELECT version_num FROM alembic_version")))
                .scalars()
                .all()
            )
        await redis.ping()
        schema, worker, storage_seen = await asyncio.gather(
            readiness.schema_state(applied),
            readiness.worker_state(),
            readiness.storage_state(),
        )
        ok = schema == "current"
        body = {
            "ok": ok,
            "commit": served_commit(),
            "checks": {"schema": schema, "worker": worker, "storage": storage_seen},
        }
        return JSONResponse(body, status_code=200 if ok else 503)

    from .realtime.ws import router as ws_router
    from .routers.activity import router as activity_router
    from .routers.admin import router as admin_router
    from .routers.admin_calls import router as admin_calls_router
    from .routers.admin_emoji import router as admin_emoji_router
    from .routers.admin_instance import router as admin_instance_router
    from .routers.admin_janus import router as admin_janus_router
    from .routers.admin_sso import router as admin_sso_router
    from .routers.agent_shell import router as agent_shell_router
    from .routers.agent_socket import router as agent_socket_router
    from .routers.agentic import router as agentic_router
    from .routers.auth import router as auth_router
    from .routers.bot_api import router as bot_api_router
    from .routers.calls import router as calls_router
    from .routers.channels import router as channel_router
    from .routers.client_errors import router as client_errors_router
    from .routers.commands import router as command_router
    from .routers.decision_log import router as decisions_router
    from .routers.drafts import router as drafts_router
    from .routers.exports import router as exports_router
    from .routers.feedback import router as feedback_router
    from .routers.files import router as file_router
    from .routers.groups import member_router as group_member_router
    from .routers.groups import router as group_router
    from .routers.interactions import router as interaction_router
    from .routers.mail import router as mail_router
    from .routers.mcp import admin_tokens_router as mcp_admin_tokens_router
    from .routers.mcp import router as mcp_router
    from .routers.mcp import tokens_router as mcp_tokens_router
    from .routers.mcp_servers import router as mcp_servers_router
    from .routers.messages import router as message_router
    from .routers.metrics import router as metrics_router
    from .routers.my_agents import router as my_agents_router
    from .routers.oauth import admin_router as oauth_admin_router
    from .routers.oauth import me_router as oauth_me_router
    from .routers.oauth import router as oauth_router
    from .routers.passkeys import router as passkeys_router
    from .routers.plugin_controls import router as plugin_controls_router
    from .routers.plugin_hosting import router as plugin_hosting_router
    from .routers.plugin_logs import router as plugin_logs_router
    from .routers.plugins import router as plugin_router
    from .routers.retention import router as retention_router
    from .routers.search import router as search_router
    from .routers.sso import router as sso_router
    from .routers.themes import router as theme_router
    from .routers.usage import router as usage_router
    from .routers.users import router as user_router
    from .routers.work import router as work_router
    from .routers.workspaces import router as workspace_router

    app.include_router(auth_router)
    app.include_router(passkeys_router)
    app.include_router(sso_router)
    app.include_router(admin_sso_router)
    app.include_router(mail_router)
    app.include_router(drafts_router)
    app.include_router(exports_router)
    app.include_router(retention_router)
    app.include_router(client_errors_router)
    app.include_router(user_router)
    app.include_router(workspace_router)
    app.include_router(channel_router)
    app.include_router(message_router)
    app.include_router(command_router)
    app.include_router(agentic_router)
    app.include_router(decisions_router)
    app.include_router(search_router)
    app.include_router(activity_router)
    app.include_router(mcp_router)
    app.include_router(mcp_tokens_router)
    app.include_router(mcp_admin_tokens_router)
    app.include_router(mcp_servers_router)
    app.include_router(oauth_router)
    app.include_router(oauth_me_router)
    app.include_router(oauth_admin_router)
    app.include_router(usage_router)
    app.include_router(metrics_router)
    app.include_router(file_router)
    app.include_router(feedback_router)
    app.include_router(interaction_router)
    app.include_router(calls_router)
    app.include_router(admin_router)
    app.include_router(admin_instance_router)
    app.include_router(admin_janus_router)
    app.include_router(admin_calls_router)
    app.include_router(admin_emoji_router)
    app.include_router(group_router)
    app.include_router(group_member_router)
    app.include_router(theme_router)
    # After `plugin_router`, which declares the literal paths (`/bridge`, `/catalog`,
    # `/activity`) that a `/{plugin_id}` route registered first would swallow.
    app.include_router(plugin_router)
    app.include_router(plugin_controls_router)
    app.include_router(plugin_logs_router)
    app.include_router(my_agents_router)
    app.include_router(work_router)
    app.include_router(plugin_hosting_router)
    app.include_router(bot_api_router)
    app.include_router(ws_router)
    app.include_router(agent_socket_router)
    app.include_router(agent_shell_router)

    # Last, so every route above answers first: a mount at "/" matches anything.
    if settings.WEB_DIST and not mount_web(app, settings.WEB_DIST):
        log.warning("WEB_DIST=%s has no index.html; serving the API only", settings.WEB_DIST)

    return app


app = create_app()
