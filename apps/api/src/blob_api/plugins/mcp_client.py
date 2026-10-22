"""Blob as an MCP client: the tools of a server an admin connected, listed and called.

Not `services/mcp.py` — that is Blob *being* an MCP server, for a person's assistant. This
is the other direction (ADR 0027): an admin connects a server — GitHub, a docs search, a
company's own — and the agents they choose may use its tools, through Blob, which holds the
credential and decides every call. Nothing here knows who asked or what a run is; it lists
and it calls.

Two eras of the protocol are live, and a client meets both (the server's twin, which
answers both, is `routers/mcp.py`):

* **Modern** (`2026-07-28`): stateless. Every request carries its version, Blob's identity
  and its (empty) capabilities in `_meta`, and mirrors `method` and the tool's name into
  `Mcp-Method` and `Mcp-Name` headers — plus each argument a tool marks with
  `x-mcp-header`, as `Mcp-Param-*`, which a client must do.
* **Legacy** (`2025-11-25` back to `2025-03-26`): an `initialize` handshake first, then
  every request echoes the session id the server minted, if it minted one.

Which one a server speaks is found the way the transport spec says: ask in the modern shape
first; a refusal that is not a recognised modern error means legacy, and Blob initialises.
The answer is kept on the server's row (`Endpoint.era`), so a call does not probe again, and
a legacy session is kept for the life of the process and re-opened when the server forgets
it.

Every request goes through the network guard first — the name is resolved and refused if
it lands inside the server's own network — and no redirect is followed. Every answer is
read against a byte budget and a deadline. Blob declares no client capabilities: it offers
no sampling, elicitation or roots, so a tool that asks for input is answered as an error
the agent can read. Nothing here raises past `McpError`, whose message is written for the
admin who connected the server and the agent that called it.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import settings
from ..lib import net, sse, telemetry
from . import egress

log = logging.getLogger("blob.mcp_client")

MODERN_VERSION = "2026-07-28"
#: The handshake revisions Blob speaks, newest first. It asks for the first and accepts
#: whichever of these the server answers with.
LEGACY_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")

VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo"
CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities"
SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo"

CLIENT_INFO = {"name": "blob", "title": "Blob", "version": "1"}

#: Errors only a modern server sends: headers that disagree with the body, a client
#: capability it needs, a protocol version it does not speak.
HEADER_MISMATCH = -32020
MISSING_CAPABILITY = -32021
UNSUPPORTED_VERSION = -32022
MODERN_ERRORS = frozenset({HEADER_MISMATCH, MISSING_CAPABILITY, UNSUPPORTED_VERSION})

#: What one answer may be, in bytes. A tool list with schemas, or one result.
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
#: What an error answer is read to, in bytes: enough for its JSON-RPC error, no page.
MAX_ERROR_BYTES = 64 * 1024
#: Pages of `tools/list` followed, and tools kept from them.
MAX_LIST_PAGES = 10
MAX_TOOLS = 128
#: A tool's description is what a model reads, and is capped as a prompt is.
MAX_DESCRIPTION_CHARS = 2_000
#: A schema larger than this is no tool a model should be handed.
MAX_SCHEMA_BYTES = 32 * 1024
CONNECT_TIMEOUT_SEC = 10.0
#: How long a legacy session is trusted before Blob opens a fresh one.
SESSION_TTL_SEC = 600.0

_SENTINEL_PREFIX = "=?base64?"
_SENTINEL_SUFFIX = "?="
#: RFC 9110's `tchar`: what a header name may be made of.
_TCHAR = frozenset("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")


class McpError(Exception):
    """A call or a listing that could not happen. The message is for people, and for the
    agent that called: it says what went wrong in words, never a stack."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class McpRefusalError(McpError):
    """The server answered the call with a JSON-RPC error — no such tool, arguments it
    will not take. A call that happened and was refused, which the agent can read and
    correct, unlike a server that could not be reached."""


class _Retry(Exception):  # noqa: N818 — a signal between two functions here, not an error
    """The server is not speaking the way the row says it does: probe again, once."""


@dataclass(frozen=True, slots=True)
class Endpoint:
    """Where a server is and how to reach it — everything a request needs."""

    server_id: str
    url: str
    #: The secret header, `(name, value)`, or None for a server that needs no credential.
    secret: tuple[str, str] | None = None
    #: `modern` or `legacy` once known; None before the first answer.
    era: str | None = None
    #: The revision last agreed — the legacy one a call echoes without shaking hands.
    protocol_version: str | None = None
    #: The operator and the workspace both let it reach a private address.
    private_ok: bool = False


@dataclass(frozen=True, slots=True)
class ToolDef:
    """One tool, as a server listed it, after Blob has checked it."""

    name: str
    title: str | None
    description: str
    #: The schema as the server sent it, `x-mcp-header` marks and all.
    input_schema: dict[str, Any]
    #: The server's own claim (`readOnlyHint`). It sets the default an admin sees; it is
    #: never trusted further than that, as the spec asks of annotations.
    read_only: bool


@dataclass(slots=True)
class Listing:
    era: str
    protocol_version: str
    server_name: str | None
    server_version: str | None
    tools: list[ToolDef]
    #: Tools left out, each with why — shown to the admin who connected the server.
    skipped: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class CallResult:
    #: What the agent is handed: the tool's text, or a line standing in for what Blob
    #: does not pass on (an image, a request for input).
    text: str
    #: The tool said it failed (`isError`), or refused the call.
    is_error: bool
    #: How the server was reached this time, so a changed era can be written back.
    era: str
    protocol_version: str


def open_client() -> httpx.AsyncClient:
    """The HTTP client every request here goes through — named, so a test replaces this
    module's client and nobody else's (the seam `lib/llm.py` and the Janus console keep)."""
    return httpx.AsyncClient(follow_redirects=False)


# ─── headers ─────────────────────────────────────────────────────────────────────────


def header_value(value: str) -> str:
    """A value as a header may carry it: as it is when it is plain visible ASCII, else in
    the transport's base64 sentinel. A plain value that happens to look like the sentinel
    is encoded too, so it cannot be read as one."""
    plain = (
        all(char == "\t" or 0x20 <= ord(char) <= 0x7E for char in value)
        and value == value.strip(" \t")
        and not (value.startswith(_SENTINEL_PREFIX) and value.endswith(_SENTINEL_SUFFIX))
    )
    if plain:
        return value
    encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
    return f"{_SENTINEL_PREFIX}{encoded}{_SENTINEL_SUFFIX}"


def param_headers(schema: Mapping[str, Any]) -> list[tuple[str, tuple[str, ...]]]:
    """The arguments a tool asks to see in headers: `(name, property path)` per mark.

    Raises ValueError when a mark breaks the transport's rules — on anything but a string,
    integer or boolean, reached through anything but `properties`, not a header token, or
    sharing a name — because a client must then leave the whole tool out.
    """
    found: list[tuple[str, tuple[str, ...]]] = []

    def visit(node: Any, path: tuple[str, ...], pure: bool) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item, path, False)
            return
        if not isinstance(node, Mapping):
            return
        if "x-mcp-header" in node:
            mark = node["x-mcp-header"]
            if not pure or not path:
                raise ValueError("an x-mcp-header mark sits where only a property may have one")
            if not isinstance(mark, str) or not mark or not set(mark) <= _TCHAR:
                raise ValueError("an x-mcp-header mark is not a valid header name")
            if node.get("type") not in ("string", "integer", "boolean"):
                raise ValueError(
                    "an x-mcp-header mark is on something not a string, integer or boolean"
                )
            found.append((mark, path))
        for key, value in node.items():
            if key == "x-mcp-header":
                continue
            if key == "properties" and isinstance(value, Mapping):
                for name, sub in value.items():
                    visit(sub, (*path, str(name)), pure)
            else:
                visit(value, path, False)

    visit(schema, (), True)
    lowered = [name.lower() for name, _ in found]
    if len(set(lowered)) != len(lowered):
        raise ValueError("two x-mcp-header marks share a name")
    return found


def _mirrored(
    marks: list[tuple[str, tuple[str, ...]]], arguments: Mapping[str, Any]
) -> dict[str, str]:
    """`Mcp-Param-*` for each marked argument the call carries; none for one it does not."""
    out: dict[str, str] = {}
    for name, path in marks:
        value: Any = arguments
        for key in path:
            if not isinstance(value, Mapping) or key not in value:
                value = None
                break
            value = value[key]
        if value is None:
            continue
        if isinstance(value, bool):
            rendered = "true" if value else "false"
        elif isinstance(value, int):
            rendered = str(value)
        elif isinstance(value, float) and value.is_integer():
            rendered = str(int(value))
        elif isinstance(value, str):
            rendered = value
        else:
            continue
        out[f"Mcp-Param-{name}"] = header_value(rendered)
    return out


def strip_marks(schema: Any) -> Any:
    """The schema without its `x-mcp-header` marks — what an agent is shown. The marks are
    transport detail, and a model provider that checks schemas strictly refuses a keyword
    it does not know."""
    if isinstance(schema, list):
        return [strip_marks(item) for item in schema]
    if isinstance(schema, Mapping):
        return {key: strip_marks(value) for key, value in schema.items() if key != "x-mcp-header"}
    return schema


# ─── the wire ────────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class _Answer:
    status: int
    headers: httpx.Headers
    #: The JSON-RPC message that answers the request, or the error body a refusal carried.
    message: dict[str, Any] | None


async def _guard(endpoint: Endpoint) -> egress.Target:
    """The network guard, before every request: a name that resolves inside the server's
    own network is refused unless the operator and the workspace both said it may be —
    and the request goes to the address that was checked (`egress`), not to whatever the
    name resolves to by the time the connection opens."""
    parsed = urlparse(endpoint.url)
    if endpoint.private_ok:
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise McpError("That is not a valid URL.")
        return egress.Target(endpoint.url)
    reason = await net.check_outbound_url(endpoint.url, require_https=True)
    if reason is not None:
        raise McpError(reason)
    goal = await egress.target(endpoint.url, trusted_address=False)
    if goal is None:
        raise McpError("That address is inside the server's own network.")
    return goal


def _base_headers(endpoint: Endpoint) -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": "Blob (MCP client)",
    }
    if endpoint.secret is not None:
        name, value = endpoint.secret
        headers[name] = value
    return telemetry.inject(headers)


def _left(deadline: float) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise McpError("The server did not answer in time.")
    return left


async def _send(
    endpoint: Endpoint,
    client: httpx.AsyncClient,
    body: dict[str, Any],
    headers: dict[str, str],
    deadline: float,
) -> _Answer:
    """POST one JSON-RPC message; answer with the response to it.

    A JSON body is read whole; an event stream is read until the message with this
    request's id arrives, past any notification the server sends first. A refusal is read
    for the JSON-RPC error it may carry, which is what tells the eras apart.
    """
    goal = await _guard(endpoint)
    left = _left(deadline)
    timeout = httpx.Timeout(left, connect=min(CONNECT_TIMEOUT_SEC, left))
    request_id = body.get("id")
    try:
        async with client.stream(
            "POST",
            goal.url,
            content=json.dumps(body).encode(),
            headers={**headers, **goal.headers},
            timeout=timeout,
            extensions=goal.extensions,
        ) as response:
            if 300 <= response.status_code < 400:
                raise McpError(
                    f"The server answered with a redirect ({response.status_code}); Blob does not "
                    "follow one. Use the address it redirects to."
                )
            if response.status_code >= 400 or request_id is None:
                raw = await _read(response, MAX_ERROR_BYTES, deadline, budget_error=False)
                return _Answer(response.status_code, response.headers, _json_object(raw))
            kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if kind == "text/event-stream":
                message = await _from_stream(response, request_id, deadline)
                return _Answer(response.status_code, response.headers, message)
            raw = await _read(response, MAX_RESPONSE_BYTES, deadline, budget_error=True)
            parsed = _json_object(raw)
            if parsed is None:
                raise McpError("The server answered with something that is not JSON-RPC.")
            return _Answer(response.status_code, response.headers, parsed)
    except McpError:
        raise
    except httpx.TimeoutException as error:
        raise McpError("The server did not answer in time.") from error
    except httpx.HTTPError as error:
        raise McpError(f"The server could not be reached ({type(error).__name__}).") from error
    except (httpx.InvalidURL, UnicodeError) as error:
        # Neither is an `HTTPError`: an address or a header HTTP cannot carry fails before
        # anything is sent, and must still come back as words rather than a 500.
        raise McpError(
            "The request could not be made: its address or a header is not one HTTP can carry."
        ) from error


async def _read(
    response: httpx.Response, budget: int, deadline: float, *, budget_error: bool
) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        if time.monotonic() > deadline:
            raise McpError("The server did not answer in time.")
        size += len(chunk)
        if size > budget:
            if budget_error:
                raise McpError("The server answered with more than Blob will read.")
            break
        chunks.append(chunk)
    return b"".join(chunks)[:budget]


async def _from_stream(
    response: httpx.Response, request_id: Any, deadline: float
) -> dict[str, Any]:
    decoder = sse.SseDecoder()
    size = 0
    async for chunk in response.aiter_bytes():
        if time.monotonic() > deadline:
            raise McpError("The server did not answer in time.")
        size += len(chunk)
        if size > MAX_RESPONSE_BYTES:
            raise McpError("The server answered with more than Blob will read.")
        for message in decoder.feed(chunk):
            if _answers(message, request_id):
                return message
    for message in decoder.close():
        if _answers(message, request_id):
            return message
    raise McpError("The server ended its answer without answering.")


def _answers(message: Mapping[str, Any], request_id: Any) -> bool:
    """Whether this is the response to our request — not a notification, not a request of
    the server's own (which Blob, declaring no capabilities, does not answer)."""
    return message.get("id") == request_id and ("result" in message or "error" in message)


def _json_object(raw: bytes) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw.decode("utf-8", errors="replace"))
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _error_of(answer: _Answer) -> dict[str, Any] | None:
    error = answer.message.get("error") if answer.message is not None else None
    return error if isinstance(error, dict) else None


def _refused(answer: _Answer) -> McpError:
    """What a refusal says, in words an admin can act on."""
    if answer.status in (401, 403):
        challenge = answer.headers.get("www-authenticate", "")
        wants_sign_in = "resource_metadata" in challenge or (
            answer.status == 401 and "bearer" in challenge.lower()
        )
        if wants_sign_in:
            return McpError(
                f"The server answered {answer.status}: it wants a sign-in Blob was not given. "
                "Blob connects with a token, not OAuth — if the server offers an API key or "
                "token, add it."
            )
        return McpError(f"The server answered {answer.status}: it refused Blob's credentials.")
    error = _error_of(answer)
    if error is not None and isinstance(error.get("message"), str):
        return McpRefusalError(f"The server refused: {error['message'][:300]}")
    return McpError(f"The server answered {answer.status}.")


# ─── sessions: one per era ───────────────────────────────────────────────────────────

#: Legacy sessions this process holds: `(server, url, secret)` → (session id, revision,
#: opened at). A worker is long-lived, so the handshake is paid once per server, not once
#: per call; the server forgetting a session is answered by opening another.
_SESSIONS: dict[tuple[str, str, str], tuple[str | None, str, float]] = {}


def _session_key(endpoint: Endpoint) -> tuple[str, str, str]:
    secret = endpoint.secret[1] if endpoint.secret is not None else ""
    return (endpoint.server_id, endpoint.url, hashlib.sha256(secret.encode()).hexdigest()[:16])


def reset_for_tests() -> None:
    _SESSIONS.clear()


@dataclass(slots=True)
class _Session:
    endpoint: Endpoint
    client: httpx.AsyncClient
    deadline: float
    era: str
    version: str
    session_id: str | None = None
    server_name: str | None = None
    server_version: str | None = None
    next_id: int = 1

    async def request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        name: str | None = None,
        extra_headers: dict[str, str] | None = None,
        final: bool = True,
    ) -> dict[str, Any]:
        """One request in this session's era. Answers its `result`; raises `McpRefusalError`
        when the server refused it, `McpError` when it could not be made, and — unless
        this is the `final` attempt — `_Retry` when the server no longer speaks the way
        the session assumed."""
        request_id = self.next_id
        self.next_id += 1
        headers = _base_headers(self.endpoint)
        headers["mcp-protocol-version"] = self.version
        if self.era == "modern":
            headers["mcp-method"] = method
            if name is not None:
                headers["mcp-name"] = header_value(name)
            body_params = {
                **params,
                "_meta": {
                    VERSION_KEY: MODERN_VERSION,
                    CLIENT_INFO_KEY: CLIENT_INFO,
                    CAPABILITIES_KEY: {},
                },
            }
        else:
            if self.session_id is not None:
                headers["mcp-session-id"] = self.session_id
            body_params = params
        if extra_headers:
            headers.update(extra_headers)
        body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": body_params}
        answer = await _send(self.endpoint, self.client, body, headers, self.deadline)
        error = _error_of(answer)
        if answer.status >= 400:
            if not final and _speaks_otherwise(self, answer, error):
                raise _Retry
            raise _refused(answer)
        if error is not None:
            message = error.get("message") if isinstance(error.get("message"), str) else ""
            raise McpRefusalError(
                f"The server refused: {message[:300]}" if message else "The server refused."
            )
        result = answer.message.get("result") if answer.message is not None else None
        if not isinstance(result, dict):
            raise McpError("The server answered without a result.")
        return result


def _speaks_otherwise(session: _Session, answer: _Answer, error: dict[str, Any] | None) -> bool:
    """Whether a refusal says the server is not where the session thought — the one case
    worth probing again for.

    A legacy server that answers 404 to a session it minted has forgotten it. A modern
    server that no longer speaks this revision says so with its own error; one that went
    back to before the revision refuses without a JSON-RPC body, or with the `-32000`
    that the older SDKs send for a request with no session. Anything else is a refusal of
    this call, and probing would only ask the same question twice.
    """
    code = error.get("code") if error is not None else None
    if session.era == "legacy":
        return answer.status == 404 and session.session_id is not None
    if code == UNSUPPORTED_VERSION:
        return True
    return answer.status in (400, 404, 405) and (error is None or code == -32000)


async def _discover(endpoint: Endpoint, client: httpx.AsyncClient, deadline: float) -> _Session:
    """Find which era the server speaks, the way the transport spec says: ask in the modern
    shape; a refusal with no modern error in it means legacy."""
    modern = _Session(endpoint, client, deadline, era="modern", version=MODERN_VERSION)
    headers = _base_headers(endpoint)
    headers.update({"mcp-protocol-version": MODERN_VERSION, "mcp-method": "server/discover"})
    body = {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "server/discover",
        "params": {
            "_meta": {
                VERSION_KEY: MODERN_VERSION,
                CLIENT_INFO_KEY: CLIENT_INFO,
                CAPABILITIES_KEY: {},
            }
        },
    }
    answer = await _send(endpoint, client, body, headers, deadline)
    if answer.status in (401, 403):
        raise _refused(answer)
    error = _error_of(answer)
    code = error.get("code") if error is not None else None
    if answer.status < 400 and error is None:
        result = answer.message.get("result") if answer.message is not None else None
        if isinstance(result, dict):
            info = (result.get("_meta") or {}).get(SERVER_INFO_KEY)
            if isinstance(info, Mapping):
                modern.server_name = _short(info.get("name"))
                modern.server_version = _short(info.get("version"))
            return modern
    if code == UNSUPPORTED_VERSION:
        data = error.get("data") if error is not None else None
        supported = data.get("supported") if isinstance(data, Mapping) else None
        offered = (
            [v for v in supported if isinstance(v, str)] if isinstance(supported, list) else []
        )
        legacy = [v for v in offered if v in LEGACY_VERSIONS]
        if legacy:
            return await _initialize(endpoint, client, deadline, prefer=legacy[0])
        raise McpError(
            "The server speaks only protocol versions Blob does not: " + ", ".join(offered[:5])
        )
    if code in (HEADER_MISMATCH, MISSING_CAPABILITY):
        raise _refused(answer)
    if answer.status >= 500:
        raise McpError(f"The server answered {answer.status}.")
    # A 4xx with nothing modern in it, or a JSON-RPC error a modern server would not send
    # for a method it must implement: a server from before the stateless revision.
    return await _initialize(endpoint, client, deadline)


async def _initialize(
    endpoint: Endpoint, client: httpx.AsyncClient, deadline: float, *, prefer: str | None = None
) -> _Session:
    """The legacy handshake: `initialize`, then `notifications/initialized`."""
    asked = prefer or LEGACY_VERSIONS[0]
    body = {
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {"protocolVersion": asked, "capabilities": {}, "clientInfo": CLIENT_INFO},
    }
    answer = await _send(endpoint, client, body, _base_headers(endpoint), deadline)
    if answer.status >= 400 or _error_of(answer) is not None:
        raise _refused(answer)
    result = answer.message.get("result") if answer.message is not None else None
    if not isinstance(result, dict):
        raise McpError("The server answered the handshake without a result.")
    agreed = result.get("protocolVersion")
    if agreed not in LEGACY_VERSIONS:
        raise McpError(
            f"The server agreed to protocol version {agreed!r}, which Blob does not speak."
        )
    session = _Session(
        endpoint,
        client,
        deadline,
        era="legacy",
        version=str(agreed),
        session_id=answer.headers.get("mcp-session-id") or None,
    )
    info = result.get("serverInfo")
    if isinstance(info, Mapping):
        session.server_name = _short(info.get("name"))
        session.server_version = _short(info.get("version"))
    headers = _base_headers(endpoint)
    headers["mcp-protocol-version"] = session.version
    if session.session_id is not None:
        headers["mcp-session-id"] = session.session_id
    notified = await _send(
        endpoint,
        client,
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers,
        deadline,
    )
    if notified.status >= 400:
        # The spec has the server accept it; one that does not has still answered the
        # handshake, and most will serve the requests that follow regardless.
        log.info("mcp: %s refused notifications/initialized (%d)", endpoint.url, notified.status)
    _SESSIONS[_session_key(endpoint)] = (session.session_id, session.version, time.monotonic())
    return session


async def _session_for(
    endpoint: Endpoint, client: httpx.AsyncClient, deadline: float, *, fresh: bool
) -> _Session:
    """The session a call goes out on: the era the row remembers, without a probe when it
    can — a modern server needs none, a legacy one reuses this process's handshake."""
    if not fresh and endpoint.era == "modern":
        return _Session(endpoint, client, deadline, era="modern", version=MODERN_VERSION)
    if not fresh and endpoint.era == "legacy":
        held = _SESSIONS.get(_session_key(endpoint))
        if held is not None and time.monotonic() - held[2] < SESSION_TTL_SEC:
            return _Session(
                endpoint, client, deadline, era="legacy", version=held[1], session_id=held[0]
            )
        return await _initialize(endpoint, client, deadline, prefer=endpoint.protocol_version)
    _SESSIONS.pop(_session_key(endpoint), None)
    return await _discover(endpoint, client, deadline)


# ─── what callers use ────────────────────────────────────────────────────────────────


def _short(value: Any, limit: int = 120) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _tool_from(raw: Any) -> ToolDef | str:
    """A listed tool, checked — or why it was left out."""
    if not isinstance(raw, Mapping):
        return "a tool that was not an object"
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 128:
        return "a tool without a usable name"
    schema = raw.get("inputSchema")
    if not isinstance(schema, Mapping):
        return f"{name}: it has no input schema"
    if len(json.dumps(schema)) > MAX_SCHEMA_BYTES:
        return f"{name}: its input schema is larger than Blob hands a model"
    try:
        param_headers(schema)
    except ValueError as error:
        return f"{name}: {error}"
    annotations = raw.get("annotations")
    hints: Mapping[str, Any] = annotations if isinstance(annotations, Mapping) else {}
    title = _short(raw.get("title")) or _short(hints.get("title"), 200)
    description = raw.get("description")
    text_ = description.strip() if isinstance(description, str) else ""
    if len(text_) > MAX_DESCRIPTION_CHARS:
        text_ = text_[: MAX_DESCRIPTION_CHARS - 1] + "…"
    return ToolDef(
        name=name,
        title=title,
        description=text_,
        input_schema=dict(schema),
        read_only=hints.get("readOnlyHint") is True,
    )


async def list_tools(endpoint: Endpoint) -> Listing:
    """Everything the server offers, checked: which era it speaks, who it says it is, and
    its tools — at most `MAX_TOOLS`, each with a usable name and schema."""
    deadline = time.monotonic() + settings.MCP_LIST_TIMEOUT_SEC
    attributes = {"server.address": urlparse(endpoint.url).hostname, "rpc.method": "tools/list"}
    with telemetry.span("mcp.client tools/list", attributes=attributes):
        async with open_client() as client:
            session = await _discover(endpoint, client, deadline)
            tools: list[ToolDef] = []
            skipped: list[str] = []
            names: set[str] = set()
            cursor: str | None = None
            for _ in range(MAX_LIST_PAGES):
                result = await session.request("tools/list", {"cursor": cursor} if cursor else {})
                raw_tools = result.get("tools")
                for raw in raw_tools if isinstance(raw_tools, list) else []:
                    tool = _tool_from(raw)
                    if isinstance(tool, str):
                        skipped.append(tool)
                    elif tool.name in names:
                        skipped.append(f"{tool.name}: listed twice")
                    else:
                        names.add(tool.name)
                        tools.append(tool)
                nxt = result.get("nextCursor")
                cursor = nxt if isinstance(nxt, str) and nxt else None
                if cursor is None:
                    break
    if len(tools) > MAX_TOOLS:
        skipped.append(f"{len(tools) - MAX_TOOLS} more past the first {MAX_TOOLS}")
        tools = tools[:MAX_TOOLS]
    return Listing(
        era=session.era,
        protocol_version=session.version,
        server_name=session.server_name,
        server_version=session.server_version,
        tools=tools,
        skipped=skipped,
    )


def _text_of(result: Mapping[str, Any]) -> str:
    """What a model is handed of a result: its text, in order, with a line standing in for
    anything Blob does not pass on."""
    parts: list[str] = []
    content = result.get("content")
    for item in content if isinstance(content, list) else []:
        if not isinstance(item, Mapping):
            continue
        kind = item.get("type")
        if kind == "text" and isinstance(item.get("text"), str):
            parts.append(item["text"])
        elif kind in ("image", "audio"):
            mime = item.get("mimeType") if isinstance(item.get("mimeType"), str) else kind
            what = "an image" if kind == "image" else "audio"
            parts.append(f"[The tool returned {what} ({mime}); Blob does not pass it on.]")
        elif kind == "resource_link" and isinstance(item.get("uri"), str):
            label = item.get("name") if isinstance(item.get("name"), str) else item["uri"]
            parts.append(f"[Link: {label} — {item['uri']}]")
        elif kind == "resource" and isinstance(item.get("resource"), Mapping):
            resource = item["resource"]
            if isinstance(resource.get("text"), str):
                parts.append(resource["text"])
            elif isinstance(resource.get("uri"), str):
                parts.append(f"[The tool returned a file: {resource['uri']}]")
    if not any(part.strip() for part in parts) and "structuredContent" in result:
        parts.append(json.dumps(result["structuredContent"], ensure_ascii=False))
    return "\n\n".join(part for part in parts if part).strip()


def _result_of(result: Mapping[str, Any], session: _Session) -> CallResult:
    kind = result.get("resultType", "complete")
    if kind == "input_required":
        return CallResult(
            "The tool asked for more input before it would run, which Blob cannot give it.",
            True,
            session.era,
            session.version,
        )
    if kind != "complete":
        return CallResult(
            f"The tool answered with a kind of result Blob does not follow ({str(kind)[:40]}).",
            True,
            session.era,
            session.version,
        )
    is_error = result.get("isError") is True
    empty = "The tool failed and said nothing more." if is_error else "The tool returned nothing."
    text_ = _text_of(result) or empty
    return CallResult(text_, is_error, session.era, session.version)


async def call_tool(
    endpoint: Endpoint,
    name: str,
    input_schema: Mapping[str, Any],
    arguments: Mapping[str, Any],
    *,
    timeout_sec: float,
) -> CallResult:
    """Call one tool. A refusal by the tool comes back as a result with `is_error`; a call
    that could not happen at all raises `McpError`."""
    deadline = time.monotonic() + timeout_sec
    try:
        marks = param_headers(input_schema)
    except ValueError as error:
        raise McpError(f"The tool's definition is not usable: {error}.") from error
    mirrored = _mirrored(marks, arguments)
    attributes = {"server.address": urlparse(endpoint.url).hostname, "rpc.method": "tools/call"}
    with telemetry.span("mcp.client tools/call", attributes=attributes):
        async with open_client() as client:
            for fresh in (False, True):
                try:
                    session = await _session_for(endpoint, client, deadline, fresh=fresh)
                except McpError:
                    if fresh:
                        raise
                    # The handshake the row expected was refused — the server may have
                    # moved to the stateless revision since. Ask it afresh, once.
                    continue
                try:
                    result = await session.request(
                        "tools/call",
                        {"name": name, "arguments": dict(arguments)},
                        name=name,
                        extra_headers=mirrored,
                        final=fresh,
                    )
                except _Retry:
                    continue
                except McpRefusalError as refusal:
                    # About the call itself — no such tool, arguments it will not take:
                    # the agent can read it and try again.
                    return CallResult(refusal.message, True, session.era, session.version)
                return _result_of(result, session)
    raise McpError("The call could not be made.")  # pragma: no cover — the loop returns or raises


__all__ = [
    "LEGACY_VERSIONS",
    "MODERN_VERSION",
    "CallResult",
    "Endpoint",
    "Listing",
    "McpError",
    "McpRefusalError",
    "ToolDef",
    "call_tool",
    "header_value",
    "list_tools",
    "open_client",
    "param_headers",
    "reset_for_tests",
    "strip_marks",
]
