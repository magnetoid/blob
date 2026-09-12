"""The MCP endpoint, and the tokens that reach it.

Two eras of the Model Context Protocol are live in the wild and this endpoint speaks both,
because the client is somebody else's and we do not get to choose which one they run.

* **Legacy** (`2025-06-18`, `2025-11-25`): the client opens with an `initialize`
  handshake, then lists and calls tools. We answer `initialize` and mint no
  `Mcp-Session-Id`, which the spec allows and which keeps every request independent —
  there is nothing to lose when a container restarts or a second one answers.
* **Modern** (`2026-07-28`): no handshake at all. Each request carries its protocol
  version in `_meta` and mirrors `method` and `params.name` into `Mcp-Method` and
  `Mcp-Name` headers, which the server must check against the body — the point being that
  a proxy routing on the header and a server executing the body cannot be made to disagree.

Which era a request belongs to is decided by what it carries, not by what it asks for: a
modern protocol version in `_meta` or in the header selects the modern path, and everything
else falls to legacy. That is the dual-era rule the spec names, and it is why `initialize`
and `tools/call` can arrive at the same URL from two clients that share no assumptions.

The bodies here are JSON-RPC, not Blob's `{"error": {...}}` envelope, so every `AppError`
raised beneath is caught and rendered as a tool error the model can read and act on.
Authentication is the one exception: no token is an HTTP 401, because that is what a client
retries against, and a JSON-RPC error would look to it like a working server refusing work.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import AppError
from ..lib.ids import IdParam
from ..schemas.base import CamelModel
from ..services import mcp as mcp_service
from ..services import mcp_tokens as token_service

log = logging.getLogger("blob.mcp")

router = APIRouter(tags=["mcp"])
tokens_router = APIRouter(prefix="/api/me/mcp-tokens", tags=["mcp"])

#: Revisions that carry their version per request and have no handshake.
MODERN_VERSIONS = ("2026-07-28",)
#: Revisions that open with `initialize`. `2025-03-26` is what a client that sends no
#: version header is assumed to be speaking, per the transport spec.
LEGACY_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
SUPPORTED_VERSIONS = MODERN_VERSIONS + LEGACY_VERSIONS

VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion"

#: JSON-RPC codes. The first three are JSON-RPC's own; the last two are MCP's.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
HEADER_MISMATCH = -32020
UNSUPPORTED_VERSION = -32022

SERVER_INFO = {
    "name": "blob",
    "title": "Blob",
    "version": "0.1.0",
}

INSTRUCTIONS = (
    "This is a Blob workspace — a team's channels, threads and direct messages. You are "
    "connected as one person and see exactly what they see. Start with `whoami` if you "
    "are unsure who that is, `list_channels` to find your way around, and `read_channel` "
    "or `search_messages` to read. Anything you post is posted under their name, in front "
    "of their colleagues, so post only what they asked for."
)


# --------------------------------------------------------------------------------------
# JSON-RPC plumbing
# --------------------------------------------------------------------------------------


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(
    request_id: Any, code: int, message: str, data: dict[str, Any] | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        body["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": body}


def _json(payload: dict[str, Any], status: int = 200) -> Response:
    return Response(
        content=json.dumps(payload),
        status_code=status,
        media_type="application/json",
    )


def _decoded(value: str) -> str:
    """A header value the client may have Base64-wrapped when it was not ASCII-safe.

    The sentinel is `=?base64?...?=` and it is case-sensitive; anything else is the value.
    """
    if value.startswith("=?base64?") and value.endswith("?="):
        try:
            return base64.b64decode(value[len("=?base64?") : -len("?=")]).decode()
        except (ValueError, UnicodeDecodeError):
            return value
    return value


def _tool_error(request_id: Any, message: str) -> dict[str, Any]:
    """A refusal the model reads rather than one the transport swallows.

    MCP separates protocol errors from tool errors on purpose: a tool that says "there is
    no channel by that name" is working correctly, and reporting it as a JSON-RPC error
    would have the client treat the *connection* as broken.
    """
    return _result(request_id, {"content": [{"type": "text", "text": message}], "isError": True})


# --------------------------------------------------------------------------------------
# The endpoint
# --------------------------------------------------------------------------------------


async def _caller(request: Request) -> mcp_service.McpCaller | None:
    header = request.headers.get("authorization", "")
    prefix = "bearer "
    if header[: len(prefix)].lower() != prefix:
        return None
    return await mcp_service.resolve_token(header[len(prefix) :].strip())


def _unauthorized() -> Response:
    response = _json(
        {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": INVALID_REQUEST, "message": "A Blob assistant token is required."},
        },
        status=401,
    )
    # What tells a client to ask for credentials rather than to give up.
    response.headers["WWW-Authenticate"] = 'Bearer realm="Blob"'
    return response


@router.post("/api/mcp")
async def mcp_endpoint(request: Request) -> Response:
    caller = await _caller(request)
    if caller is None:
        return _unauthorized()

    try:
        body = await request.json()
    except Exception:
        return _json(_error(None, PARSE_ERROR, "That is not JSON."), status=400)
    if not isinstance(body, dict):
        # A batch (a JSON array) was removed from the protocol in 2025-06-18 and never
        # came back; anything else is not a message at all.
        return _json(_error(None, INVALID_REQUEST, "Send one JSON-RPC message."), status=400)

    method = body.get("method")
    request_id = body.get("id")
    raw_params = body.get("params")
    params: dict[str, Any] = raw_params if isinstance(raw_params, dict) else {}
    raw_meta = params.get("_meta")
    meta: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
    header_version = request.headers.get("mcp-protocol-version")
    meta_version = meta.get(VERSION_META_KEY)

    if not isinstance(method, str):
        return _json(_error(request_id, INVALID_REQUEST, "A message needs a method."), status=400)

    is_modern = meta_version in MODERN_VERSIONS or header_version in MODERN_VERSIONS
    if is_modern:
        return await _modern(request, caller, body, method, request_id, params, meta_version)
    return await _legacy(caller, method, request_id, params, header_version)


async def _modern(
    request: Request,
    caller: mcp_service.McpCaller,
    body: dict[str, Any],
    method: str,
    request_id: Any,
    params: dict[str, Any],
    meta_version: Any,
) -> Response:
    """A request that carries its own version and mirrors its shape into headers."""
    header_version = request.headers.get("mcp-protocol-version")
    if meta_version is None or header_version is None or meta_version != header_version:
        return _json(
            _error(
                request_id,
                HEADER_MISMATCH,
                "MCP-Protocol-Version must be present and match "
                f"params._meta['{VERSION_META_KEY}'].",
            ),
            status=400,
        )
    if meta_version not in MODERN_VERSIONS:
        return _json(
            _error(
                request_id,
                UNSUPPORTED_VERSION,
                "Unsupported protocol version",
                {"supported": list(SUPPORTED_VERSIONS), "requested": meta_version},
            ),
            status=400,
        )

    if method.startswith("notifications/"):
        # Checked before the mirrored headers: this revision defines no client-to-server
        # notification on this transport and states no header rules for one, so refusing
        # it on a missing `Mcp-Method` would be inventing a requirement.
        return Response(status_code=202)

    header_method = request.headers.get("mcp-method")
    if header_method != method:
        return _json(
            _error(
                request_id,
                HEADER_MISMATCH,
                f"Mcp-Method header {header_method!r} does not match the body's {method!r}.",
            ),
            status=400,
        )

    if method == "server/discover":
        return _json(_result(request_id, _discovery()))

    if method == "tools/list":
        return _json(_result(request_id, {"tools": mcp_service.catalogue(caller)}))

    if method == "tools/call":
        name = params.get("name")
        header_name = request.headers.get("mcp-name")
        if header_name is None or _decoded(header_name) != name:
            return _json(
                _error(
                    request_id,
                    HEADER_MISMATCH,
                    "Mcp-Name header does not match params.name.",
                ),
                status=400,
            )
        return _json(await _call_tool(caller, request_id, params))

    # 404 rather than 200: it is what distinguishes a modern server that does not know
    # this method from an old server that does not host this endpoint at all.
    return _json(_error(request_id, METHOD_NOT_FOUND, f"No such method: {method}."), status=404)


async def _legacy(
    caller: mcp_service.McpCaller,
    method: str,
    request_id: Any,
    params: dict[str, Any],
    header_version: str | None,
) -> Response:
    """A client that opens with `initialize` and expects a session that we do not need."""
    if method == "initialize":
        asked = params.get("protocolVersion")
        # Echo what they asked for when we speak it *in this era*, otherwise name our
        # newest legacy revision. `SUPPORTED_VERSIONS` here was a bug with one word in
        # it: a legacy client politely asking for a modern revision was told yes, then
        # 400'd on every request after, because `_modern` demands a `params._meta` an
        # `initialize` handshake never sends. A handshake can only ever agree a handshake
        # version.
        agreed = asked if asked in LEGACY_VERSIONS else LEGACY_VERSIONS[0]
        return _json(
            _result(
                request_id,
                {
                    "protocolVersion": agreed,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": SERVER_INFO,
                    "instructions": INSTRUCTIONS,
                },
            )
        )

    if method.startswith("notifications/"):
        return Response(status_code=202)

    if header_version is not None and header_version not in SUPPORTED_VERSIONS:
        return _json(
            _error(
                request_id,
                UNSUPPORTED_VERSION,
                "Unsupported protocol version",
                {"supported": list(SUPPORTED_VERSIONS), "requested": header_version},
            ),
            status=400,
        )

    if method == "ping":
        return _json(_result(request_id, {}))

    if method == "tools/list":
        return _json(_result(request_id, {"tools": mcp_service.catalogue(caller)}))

    if method == "tools/call":
        return _json(await _call_tool(caller, request_id, params))

    return _json(_error(request_id, METHOD_NOT_FOUND, f"No such method: {method}."))


def _discovery() -> dict[str, Any]:
    return {
        "protocolVersions": list(SUPPORTED_VERSIONS),
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": SERVER_INFO,
        "instructions": INSTRUCTIONS,
    }


async def _call_tool(
    caller: mcp_service.McpCaller, request_id: Any, params: dict[str, Any]
) -> dict[str, Any]:
    name = params.get("name")
    raw_arguments = params.get("arguments")
    arguments: dict[str, Any] = raw_arguments if isinstance(raw_arguments, dict) else {}
    if not isinstance(name, str):
        return _error(request_id, INVALID_PARAMS, "A tool call needs a name.")
    if not mcp_service.known(name):
        return _error(request_id, INVALID_PARAMS, f"Unknown tool: {name}.")

    try:
        text_out = await mcp_service.call(caller, name, arguments)
    except AppError as refusal:
        # An expected no — a channel that is not there, a limit spent, a token that may
        # only read. The model is told, and the connection stays up.
        return _tool_error(request_id, refusal.message)
    except Exception:
        log.exception("mcp tool %s failed", name)
        return _tool_error(request_id, "Something went wrong on the server running that tool.")

    return _result(request_id, {"content": [{"type": "text", "text": text_out}], "isError": False})


@router.get("/api/mcp")
@router.delete("/api/mcp")
async def mcp_not_allowed() -> Response:
    """The GET stream and DELETE session of the older transport, which we do not host.

    `405` rather than `404` is what tells a client the endpoint exists and this verb does
    not, which is the difference between falling back and giving up.
    """
    return _json(
        _error(None, INVALID_REQUEST, "This MCP endpoint takes POST only."),
        status=405,
    )


# --------------------------------------------------------------------------------------
# Minting and revoking, from the browser
# --------------------------------------------------------------------------------------


class TokenSummary(CamelModel):
    id: str
    name: str
    scopes: list[str]
    created_at: str
    last_used_at: str | None = None


class TokensOut(CamelModel):
    tokens: list[TokenSummary]
    #: The URL to paste into an assistant. Absolute, because the person is going to put it
    #: somewhere that has never heard of this server.
    url: str


class CreateTokenInput(CamelModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    #: Read is not optional. This is whether the assistant may also post.
    can_write: bool = False


class CreatedTokenOut(CamelModel):
    token: TokenSummary
    #: Shown once and never again — only its hash is stored.
    secret: str
    url: str


def _summary(row: Any) -> TokenSummary:
    return TokenSummary(
        id=str(row.id),
        name=row.name,
        scopes=list(row.scopes),
        created_at=row.created_at.isoformat(),
        last_used_at=row.last_used_at.isoformat() if row.last_used_at else None,
    )


def _endpoint_url() -> str:
    return f"{settings.PUBLIC_URL.rstrip('/')}/api/mcp"


@tokens_router.get("", response_model=TokensOut)
async def list_tokens(user: SessionUser = Depends(current_user)) -> TokensOut:
    async with session_scope() as session:
        rows = await token_service.list_for(session, user.id)
    return TokensOut(tokens=[_summary(row) for row in rows], url=_endpoint_url())


@tokens_router.post("", response_model=CreatedTokenOut)
async def create_token(
    payload: CreateTokenInput, user: SessionUser = Depends(current_user)
) -> CreatedTokenOut:
    async with transaction() as (session, _after):
        row, secret = await token_service.mint(
            session, user, name=payload.name.strip(), can_write=payload.can_write
        )
    return CreatedTokenOut(token=_summary(row), secret=secret, url=_endpoint_url())


@tokens_router.delete("/{token_id}")
async def revoke_token(
    token_id: IdParam, user: SessionUser = Depends(current_user)
) -> dict[str, bool]:
    async with transaction() as (session, _after):
        await token_service.revoke(session, user, token_id)
    return {"ok": True}


__all__ = ["MODERN_VERSIONS", "SUPPORTED_VERSIONS", "router", "tokens_router"]
