"""Sign-in for assistants that connect to the MCP endpoint (ADR 0029).

Three kinds of route, with three kinds of caller:

* **Discovery, registration, tokens and revocation** — `/.well-known/…` and `/oauth/…` —
  are an OAuth client's, usually somebody else's server. They read no cookie, so they sit
  outside `/api` and outside the session check, answer in RFC 6749's error shape rather
  than Blob's envelope, and allow any origin: there is no ambient credential for another
  site to borrow.
* **The consent page's two calls** — `/api/oauth/authorize` and `/api/oauth/requests/…` —
  are the person's, behind their session like any other `/api` route. The page itself is
  the client's (`/oauth/authorize` is a client route), so a person who is not signed in
  signs in first and lands back on the question.
* **Connected apps** — a person's own under `/api/oauth/grants`, the workspace's for an
  admin under `/api/admin/oauth-grants` — mirror the pasted tokens' lists beside them.
"""

from __future__ import annotations

import base64
import json
from typing import Annotated, Any
from urllib.parse import parse_qsl, unquote

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib import rate_limit
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.caller import client_key
from ..lib.errors import AppError, bad_request
from ..lib.ids import IdParam
from ..schemas.base import CamelModel, iso
from ..services import audit as audit_service
from ..services import oauth as oauth_service

router = APIRouter(tags=["oauth"])
me_router = APIRouter(prefix="/api/oauth", tags=["oauth"])
admin_router = APIRouter(prefix="/api/admin/oauth-grants", tags=["oauth"])

#: RFC 6749 §5.1: nothing that carries a token may be cached anywhere.
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}
#: These routes take no cookie, so letting any origin read them lends nobody anything —
#: and a browser-based MCP client cannot sign in without it.
_ANY_ORIGIN = {"Access-Control-Allow-Origin": "*"}
_METADATA_CACHE = {"Cache-Control": "public, max-age=3600"}
#: The longest authorization request the consent page passes on. Real ones are a few
#: hundred bytes; a CIMD client id is a URL and a state is the client's own.
QUERY_MAX = 8_000
FORM_MAX = 16_000


def _json(payload: Any, status: int = 200, headers: dict[str, str] | None = None) -> Response:
    return Response(
        content=json.dumps(payload),
        status_code=status,
        media_type="application/json",
        headers=headers,
    )


def _oauth_error(error: oauth_service.OAuthError) -> Response:
    return _json(
        {"error": error.error, "error_description": error.description},
        status=error.status,
        headers={**_NO_STORE, **_ANY_ORIGIN},
    )


async def _throttled(bucket: str, request: Request) -> Response | None:
    """The limiter's 429, in the shape an OAuth client reads."""
    try:
        await rate_limit.consume(bucket, client_key(request))
    except AppError as refusal:
        return _json(
            {"error": "temporarily_unavailable", "error_description": refusal.message},
            status=429,
            headers={**_NO_STORE, **_ANY_ORIGIN, "Retry-After": "60"},
        )
    return None


async def _form(request: Request) -> dict[str, str]:
    """The token and revocation endpoints' body: form-encoded, as RFC 6749 requires —
    and JSON, which some clients send anyway. A parameter given twice is refused (§3.1)."""
    raw = await request.body()
    if len(raw) > FORM_MAX:
        raise oauth_service.OAuthError("invalid_request", "That request is too large.")
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = json.loads(raw or b"{}")
        except ValueError as error:
            raise oauth_service.OAuthError("invalid_request", "That is not JSON.") from error
        if not isinstance(body, dict):
            raise oauth_service.OAuthError("invalid_request", "Send an object.")
        form = {key: value for key, value in body.items() if isinstance(value, str)}
    else:
        form = _single(parse_qsl(raw.decode("utf-8", "replace"), keep_blank_values=False))
    basic = _basic_client(request)
    if basic is not None:
        if form.get("client_id", basic) != basic:
            raise oauth_service.OAuthError("invalid_request", "Two different client ids.")
        form["client_id"] = basic
    return form


def _basic_client(request: Request) -> str | None:
    """The client id of a client that authenticates with HTTP Basic though it was
    registered as public — some do, whatever the registration said. Every client here is
    public (no secret is ever issued), so the id is what counts and a secret means nothing."""
    header = request.headers.get("authorization", "")
    if header[:6].lower() != "basic ":
        return None
    try:
        decoded = base64.b64decode(header[6:].strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise oauth_service.OAuthError(
            "invalid_client", "That Basic header is unreadable."
        ) from error
    client_id, _, _secret = decoded.partition(":")
    return unquote(client_id) or None


def _single(pairs: list[tuple[str, str]]) -> dict[str, str]:
    seen: dict[str, str] = {}
    for key, value in pairs:
        if key in seen:
            raise oauth_service.OAuthError("invalid_request", f"{key} was given twice.")
        seen[key] = value
    return seen


# ─── discovery ───────────────────────────────────────────────────────────────────────


@router.get("/.well-known/oauth-protected-resource/api/mcp", include_in_schema=False)
@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
async def protected_resource() -> Response:
    """RFC 9728: what the MCP endpoint is, and who signs people in for it."""
    return _json(
        oauth_service.protected_resource_metadata(), headers={**_METADATA_CACHE, **_ANY_ORIGIN}
    )


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
async def authorization_server() -> Response:
    """RFC 8414: where to send a person, where to trade a code, what is supported."""
    return _json(
        oauth_service.authorization_server_metadata(),
        headers={**_METADATA_CACHE, **_ANY_ORIGIN},
    )


@router.options("/oauth/register", include_in_schema=False)
@router.options("/oauth/token", include_in_schema=False)
@router.options("/oauth/revoke", include_in_schema=False)
async def preflight() -> Response:
    return Response(
        status_code=204,
        headers={
            **_ANY_ORIGIN,
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version",
            "Access-Control-Max-Age": "86400",
        },
    )


# ─── the client's endpoints ──────────────────────────────────────────────────────────


@router.post("/oauth/register", include_in_schema=False)
async def register(request: Request) -> Response:
    """Dynamic Client Registration (RFC 7591), for clients without a metadata document."""
    if (refused := await _throttled("oauth_register", request)) is not None:
        return refused
    try:
        raw = await request.body()
        if len(raw) > FORM_MAX:
            raise oauth_service.OAuthError("invalid_client_metadata", "That is too large.")
        try:
            payload = json.loads(raw or b"{}")
        except ValueError as error:
            raise oauth_service.OAuthError("invalid_client_metadata", "Send JSON.") from error
        if not isinstance(payload, dict):
            raise oauth_service.OAuthError("invalid_client_metadata", "Send an object.")
        registered = await oauth_service.register(payload)
    except oauth_service.OAuthError as error:
        return _oauth_error(error)
    return _json(registered, status=201, headers={**_NO_STORE, **_ANY_ORIGIN})


@router.post("/oauth/token", include_in_schema=False)
async def token(request: Request) -> Response:
    if (refused := await _throttled("oauth_token", request)) is not None:
        return refused
    try:
        form = await _form(request)
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            issued = await oauth_service.exchange_code(form)
        elif grant_type == "refresh_token":
            issued = await oauth_service.refresh(form)
        else:
            raise oauth_service.OAuthError(
                "unsupported_grant_type", "authorization_code or refresh_token."
            )
    except oauth_service.OAuthError as error:
        return _oauth_error(error)
    return _json(issued, headers={**_NO_STORE, **_ANY_ORIGIN})


@router.post("/oauth/revoke", include_in_schema=False)
async def revoke(request: Request) -> Response:
    """RFC 7009. A 200 whether or not the token meant anything, as the RFC asks."""
    if (refused := await _throttled("oauth_token", request)) is not None:
        return refused
    try:
        form = await _form(request)
    except oauth_service.OAuthError as error:
        return _oauth_error(error)
    await oauth_service.revoke_token(form.get("token", ""))
    return Response(status_code=200, headers={**_NO_STORE, **_ANY_ORIGIN})


# ─── the consent page ────────────────────────────────────────────────────────────────


class OAuthAuthorizeIn(CamelModel):
    #: The query string the browser arrived at `/oauth/authorize` with, passed on whole.
    query: Annotated[str, Field(max_length=QUERY_MAX)]


class OAuthConsentRequestOut(CamelModel):
    id: str
    client_name: str
    #: The domain whose metadata document named the app; null for one that registered
    #: itself, which is only its own word.
    vouched_by: str | None
    #: Where the answer goes — what the person checks before saying yes.
    redirect_host: str
    #: The answer goes to a program on this computer rather than to a website.
    local: bool
    #: What the app asked for: always read, and write if it wants to post.
    scopes: list[str]


class OAuthAuthorizeOut(CamelModel):
    #: What to ask the person. Absent when the request is answered without asking.
    request: OAuthConsentRequestOut | None = None
    #: Where to send the browser instead: the app, told what was wrong with its request.
    redirect_to: str | None = None


@me_router.post("/authorize", response_model=OAuthAuthorizeOut)
async def authorize(
    payload: OAuthAuthorizeIn, user: SessionUser = Depends(current_user)
) -> OAuthAuthorizeOut:
    await rate_limit.consume("oauth_authorize", user.id)
    try:
        params = _single(parse_qsl(payload.query.lstrip("?"), keep_blank_values=False))
        outcome = await oauth_service.begin(params, user_id=user.id, workspace_id=user.workspace_id)
    except oauth_service.OAuthError as error:
        raise bad_request(error.description, code="oauth_request_invalid") from error
    except oauth_service.PageError as error:
        raise bad_request(error.message, code="oauth_request_invalid") from error
    if isinstance(outcome, str):
        return OAuthAuthorizeOut(redirect_to=outcome)
    return OAuthAuthorizeOut(
        request=OAuthConsentRequestOut(
            id=outcome.id,
            client_name=outcome.client_name,
            vouched_by=outcome.vouched_by,
            redirect_host=outcome.redirect_host,
            local=outcome.local,
            scopes=outcome.scopes,
        )
    )


class OAuthConsentIn(CamelModel):
    approve: bool
    #: Whether the app may also post as the person. Only means anything when it asked.
    write: bool = False


class OAuthConsentOut(CamelModel):
    redirect_to: str


@me_router.post("/requests/{request_id}", response_model=OAuthConsentOut)
async def decide(
    request_id: IdParam,
    payload: OAuthConsentIn,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> OAuthConsentOut:
    try:
        url = await oauth_service.decide(
            request_id,
            user_id=user.id,
            approve=payload.approve,
            write=payload.write,
            actor=audit_service.actor_for(request, user),
        )
    except oauth_service.PageError as error:
        raise bad_request(error.message, code="oauth_request_invalid") from error
    return OAuthConsentOut(redirect_to=url)


# ─── connected apps ──────────────────────────────────────────────────────────────────


class OAuthGrantOut(CamelModel):
    id: str
    client_name: str
    vouched_by: str | None
    scopes: list[str]
    created_at: str
    last_used_at: str | None = None


class OAuthGrantsOut(CamelModel):
    grants: list[OAuthGrantOut]
    #: The address to give an assistant: it finds its own way to sign in from there.
    url: str


class WorkspaceOAuthGrantOut(OAuthGrantOut):
    owner_id: str
    owner_name: str


class WorkspaceOAuthGrantsOut(CamelModel):
    grants: list[WorkspaceOAuthGrantOut]


def _grant(view: oauth_service.GrantView) -> OAuthGrantOut:
    return OAuthGrantOut(
        id=view.id,
        client_name=view.client_name,
        vouched_by=view.vouched_by,
        scopes=view.scopes,
        created_at=iso(view.created_at) or "",
        last_used_at=iso(view.last_used_at),
    )


@me_router.get("/grants", response_model=OAuthGrantsOut)
async def my_grants(user: SessionUser = Depends(current_user)) -> OAuthGrantsOut:
    async with session_scope() as session:
        views = await oauth_service.grants_of(session, user.id)
    return OAuthGrantsOut(grants=[_grant(view) for view in views], url=oauth_service.resource())


@me_router.delete("/grants/{grant_id}")
async def end_my_grant(
    grant_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> dict[str, bool]:
    async with transaction() as (session, _after):
        await oauth_service.end_grant(
            session,
            grant_id,
            workspace_id=user.workspace_id,
            user_id=user.id,
            actor=audit_service.actor_for(request, user),
        )
    return {"ok": True}


@admin_router.get("", response_model=WorkspaceOAuthGrantsOut)
async def workspace_grants(admin: SessionUser = Depends(require_admin)) -> WorkspaceOAuthGrantsOut:
    """Every app connected as one of the workspace's people — the same view an admin has
    of pasted tokens, because a sign-in acts as a colleague just as a token does."""
    async with session_scope() as session:
        views = await oauth_service.grants_in(session, admin.workspace_id)
    return WorkspaceOAuthGrantsOut(
        grants=[
            WorkspaceOAuthGrantOut(
                **_grant(view).model_dump(), owner_id=view.user_id, owner_name=view.owner_name
            )
            for view in views
        ]
    )


@admin_router.delete("/{grant_id}")
async def end_workspace_grant(
    grant_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> dict[str, bool]:
    async with transaction() as (session, _after):
        await oauth_service.end_grant(
            session,
            grant_id,
            workspace_id=admin.workspace_id,
            user_id=None,
            actor=audit_service.actor_for(request, admin),
        )
    return {"ok": True}


__all__ = ["admin_router", "me_router", "router"]
