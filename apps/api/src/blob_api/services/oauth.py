"""Blob as the OAuth authorization server for its own MCP endpoint (ADR 0029).

An assistant — Claude, ChatGPT, anything that speaks MCP — connects to `/api/mcp` by URL:
the endpoint answers 401 with where its metadata is, the assistant finds this server, and
the person is sent through a sign-in here and asked whether to let it act as them. Yes
mints a grant; the grant mints hour-long access tokens that are ordinary MCP tokens
(`mcp_tokens.grant_id`), so the endpoint resolves one exactly as it resolves a pasted one —
to the person (ADR 0016) — and a rotating refresh chain keeps it going.

What the 2026-07-28 authorization spec asks of a server, and how it is kept here:

- **Discovery**: protected resource metadata (RFC 9728) at the path-suffixed well-known
  URI, named in the 401's `WWW-Authenticate`; authorization server metadata (RFC 8414)
  with `code_challenge_methods_supported`, `client_id_metadata_document_supported` and
  `authorization_response_iss_parameter_supported`.
- **Clients**: by Client ID Metadata Document — a `client_id` that is an https URL, whose
  document is fetched through the network guard, must name itself, and is cached a day —
  or by Dynamic Client Registration (RFC 7591), deprecated by the spec and kept because
  some clients still use it. Public clients only: no secrets.
- **The flow**: authorization code with PKCE `S256` only; redirect URIs matched exactly,
  except that a loopback one matches on any port (RFC 8252 §7.3); `resource` must be this
  endpoint (RFC 8707) when given; `iss` on every response (RFC 9207); codes single-use and
  five minutes long; refresh tokens rotated, and a replayed one ends the grant.
- **Consent is a person's, every time a client asks**: the screen names the client as it
  names itself, the domain that vouches for it (a metadata document's host, or nobody's
  for a registered one), and where the answer goes — and says so plainly when that is a
  program on the person's own computer.

Codes and pending consent requests live in Redis, briefly; grants, clients and refresh
tokens in Postgres. Nothing here logs a token or a code.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import net
from ..lib.auth import hash_token
from ..lib.errors import not_found
from ..lib.ids import new_id, new_token
from ..lib.redis import redis
from . import audit as audit_service

log = logging.getLogger("blob.oauth")

SCOPES = ("read", "write")
ACCESS_TTL_SEC = 3_600
REFRESH_TTL_DAYS = 30
CODE_TTL_SEC = 300
REQUEST_TTL_SEC = 600
METADATA_MAX_BYTES = 16 * 1024
METADATA_CACHE_SEC = 24 * 3600
METADATA_TIMEOUT_SEC = 5.0
MAX_REDIRECT_URIS = 10
URI_MAX = 2_000
NAME_MAX = 200
LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})
_VERIFIER = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_CHALLENGE = re.compile(r"^[A-Za-z0-9\-_]{43}$")


class OAuthError(Exception):
    """An error the token, registration or revocation endpoint answers as RFC 6749 says."""

    def __init__(self, error: str, description: str, status: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status


class PageError(Exception):
    """An authorization request that cannot be answered by redirecting — an unknown
    client, a redirect URI it never registered — and so is said to the person instead."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# ─── who and where ───────────────────────────────────────────────────────────────────


def issuer() -> str:
    return settings.PUBLIC_URL.rstrip("/")


def resource() -> str:
    """The MCP endpoint's canonical URI (RFC 8707): what every token here is for."""
    return f"{issuer()}/api/mcp"


def resource_metadata_url() -> str:
    return f"{issuer()}/.well-known/oauth-protected-resource/api/mcp"


def challenge(*, invalid: bool = False) -> str:
    """The `WWW-Authenticate` a 401 from the MCP endpoint carries: where to find out how
    to sign in, and what to ask for."""
    error = 'error="invalid_token", ' if invalid else ""
    return f'Bearer {error}resource_metadata="{resource_metadata_url()}", scope="read write"'


def protected_resource_metadata() -> dict[str, Any]:
    return {
        "resource": resource(),
        "authorization_servers": [issuer()],
        "scopes_supported": list(SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_name": "Blob",
    }


def authorization_server_metadata() -> dict[str, Any]:
    base = issuer()
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": list(SCOPES),
        "client_id_metadata_document_supported": True,
        "authorization_response_iss_parameter_supported": True,
    }


# ─── redirect URIs ───────────────────────────────────────────────────────────────────


def _loopback(uri: str) -> bool:
    parsed = urlparse(uri)
    return parsed.scheme == "http" and (parsed.hostname or "") in LOOPBACK


def acceptable_redirect(uri: str) -> bool:
    """https anywhere, or http to this computer (RFC 8252); never a fragment."""
    if not isinstance(uri, str) or not uri or len(uri) > URI_MAX:
        return False
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False
    if parsed.fragment or not parsed.hostname:
        return False
    return parsed.scheme == "https" or _loopback(uri)


def redirect_matches(registered: list[str], presented: str) -> bool:
    """Exact, as the spec requires — except a loopback URI, whose port a native client
    picks at run time and so may not have registered (RFC 8252 §7.3)."""
    if presented in registered:
        return True
    if not _loopback(presented):
        return False
    wanted = urlparse(presented)
    for uri in registered:
        known = urlparse(uri)
        if (
            _loopback(uri)
            and known.hostname == wanted.hostname
            and known.path == wanted.path
            and known.query == wanted.query
        ):
            return True
    return False


# ─── clients ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Client:
    id: str
    client_id: str
    kind: str
    client_name: str
    redirect_uris: list[str]

    @property
    def vouched_by(self) -> str | None:
        """The domain that vouches for this client: a metadata document's host. A
        registered client is nobody's but its own word."""
        return urlparse(self.client_id).hostname if self.kind == "metadata" else None


def open_client() -> httpx.AsyncClient:
    """What fetches a client's metadata document — named, so a test replaces it."""
    return httpx.AsyncClient(follow_redirects=False)


def _client_of(row: Any) -> Client:
    return Client(
        id=str(row.id),
        client_id=row.client_id,
        kind=row.kind,
        client_name=row.client_name,
        redirect_uris=list(row.redirect_uris),
    )


async def client_for(client_id: str) -> Client:
    """The client a `client_id` names: a metadata document's, fetched or cached, or one
    that registered. A `PageError` for one that is neither."""
    if not client_id or len(client_id) > URI_MAX:
        raise PageError("The app did not say who it is.")
    if client_id.startswith("https://"):
        return await _metadata_client(client_id)
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT * FROM oauth_clients WHERE client_id = :id AND kind = 'registered'"),
                {"id": client_id},
            )
        ).first()
    if row is None:
        raise PageError("That app is not one this server knows. Connect it again from the app.")
    return _client_of(row)


async def _metadata_client(url: str) -> Client:
    parsed = urlparse(url)
    if not parsed.hostname or parsed.path in ("", "/") or parsed.fragment:
        raise PageError("The app's address is not a client metadata document.")
    async with session_scope() as session:
        cached = (
            await session.execute(
                text(
                    """
                    SELECT *, fetched_at > now() - make_interval(secs => :ttl) AS fresh
                      FROM oauth_clients WHERE client_id = :id AND kind = 'metadata'
                    """
                ),
                {"id": url, "ttl": METADATA_CACHE_SEC},
            )
        ).first()
    if cached is not None and cached.fresh:
        return _client_of(cached)
    try:
        document = await _fetch_metadata(url)
    except PageError:
        if cached is not None:
            # The document was good when it was last read; a host that is down for a
            # moment should not lock its users out of what they already allowed.
            return _client_of(cached)
        raise
    names = document["client_name"]
    async with transaction() as (session, _after):
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO oauth_clients
                           (id, client_id, kind, client_name, client_uri, redirect_uris,
                            fetched_at)
                    VALUES (:pk, :id, 'metadata', :name, :uri, :redirects, now())
                    ON CONFLICT (client_id) DO UPDATE
                       SET client_name = EXCLUDED.client_name,
                           client_uri = EXCLUDED.client_uri,
                           redirect_uris = EXCLUDED.redirect_uris,
                           fetched_at = now()
                    RETURNING *
                    """
                ),
                {
                    "pk": new_id(),
                    "id": url,
                    "name": names,
                    "uri": document.get("client_uri"),
                    "redirects": document["redirect_uris"],
                },
            )
        ).one()
    return _client_of(row)


async def _fetch_metadata(url: str) -> dict[str, Any]:
    """Read and check a client metadata document. Through the network guard — an address
    inside the server's own network is refused whatever the policy — with no redirects,
    a few seconds and a few kilobytes."""
    reason = await net.check_outbound_url(url, require_https=True)
    if reason is not None:
        raise PageError("The app's metadata cannot be fetched from where it says it is.")
    try:
        async with open_client() as client:
            async with client.stream(
                "GET",
                url,
                headers={"accept": "application/json"},
                timeout=httpx.Timeout(METADATA_TIMEOUT_SEC),
            ) as response:
                if response.status_code != 200:
                    raise PageError("The app's metadata could not be read.")
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > METADATA_MAX_BYTES:
                        raise PageError("The app's metadata is larger than it should be.")
    except httpx.HTTPError as error:
        raise PageError("The app's metadata could not be read.") from error
    try:
        document = json.loads(body)
    except ValueError as error:
        raise PageError("The app's metadata is not JSON.") from error
    if not isinstance(document, dict) or document.get("client_id") != url:
        raise PageError("The app's metadata does not name itself; it cannot be trusted.")
    name = document.get("client_name")
    redirects = document.get("redirect_uris")
    if not isinstance(name, str) or not name.strip():
        raise PageError("The app's metadata does not say what it is called.")
    if (
        not isinstance(redirects, list)
        or not 1 <= len(redirects) <= MAX_REDIRECT_URIS
        or not all(acceptable_redirect(uri) for uri in redirects)
    ):
        raise PageError("The app's metadata lists addresses it may not return to.")
    uri = document.get("client_uri")
    return {
        "client_name": " ".join(name.split())[:NAME_MAX],
        "redirect_uris": redirects,
        "client_uri": uri if isinstance(uri, str) and len(uri) <= URI_MAX else None,
    }


async def register(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Dynamic Client Registration (RFC 7591) — deprecated by the 2026 spec, kept for the
    clients still using it. A public client, always: a secret asked for is not issued, and
    the answer says so (`token_endpoint_auth_method: none`)."""
    redirects = payload.get("redirect_uris")
    if (
        not isinstance(redirects, list)
        or not 1 <= len(redirects) <= MAX_REDIRECT_URIS
        or not all(acceptable_redirect(uri) for uri in redirects)
    ):
        raise OAuthError(
            "invalid_redirect_uri", "redirect_uris must be https, or http to this computer."
        )
    grants = payload.get("grant_types") or ["authorization_code", "refresh_token"]
    if not isinstance(grants, list) or not set(grants) <= {"authorization_code", "refresh_token"}:
        raise OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token.")
    responses = payload.get("response_types") or ["code"]
    if responses != ["code"]:
        raise OAuthError("invalid_client_metadata", "Only the code response type.")
    raw_name = payload.get("client_name")
    name = " ".join(raw_name.split())[:NAME_MAX] if isinstance(raw_name, str) else ""
    client_id = new_token(24)
    async with transaction() as (session, _after):
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO oauth_clients (id, client_id, kind, client_name, redirect_uris)
                    VALUES (:pk, :id, 'registered', :name, :redirects)
                    RETURNING created_at
                    """
                ),
                {
                    "pk": new_id(),
                    "id": client_id,
                    "name": name or "An assistant",
                    "redirects": redirects,
                },
            )
        ).one()
    return {
        "client_id": client_id,
        "client_id_issued_at": int(row.created_at.timestamp()),
        "client_name": name or "An assistant",
        "redirect_uris": redirects,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }


# ─── the authorization request, and the person's answer ──────────────────────────────


@dataclass(frozen=True, slots=True)
class Pending:
    id: str
    client_pk: str
    client_id: str
    client_name: str
    vouched_by: str | None
    redirect_uri: str
    #: Whether the request named its redirect URI, or left it to the only one registered
    #: — which decides whether the token request has to repeat it (RFC 6749 §4.1.3).
    redirect_given: bool
    state: str | None
    code_challenge: str
    scopes: list[str]
    user_id: str
    workspace_id: str

    @property
    def redirect_host(self) -> str:
        return urlparse(self.redirect_uri).hostname or ""

    @property
    def local(self) -> bool:
        """The answer goes to a program on this computer, not to a website."""
        return _loopback(self.redirect_uri)


def answer_url(redirect_uri: str, params: Mapping[str, str | None]) -> str:
    """The redirect URI with an authorization response on it — `iss` always (RFC 9207)."""
    pairs = {key: value for key, value in params.items() if value is not None}
    pairs["iss"] = issuer()
    joiner = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{joiner}{urlencode(pairs)}"


def _refusal(pending_uri: str, state: str | None, error: str, description: str) -> str:
    return answer_url(
        pending_uri, {"error": error, "error_description": description, "state": state}
    )


async def begin(params: Mapping[str, str], *, user_id: str, workspace_id: str) -> Pending | str:
    """Check an authorization request. Answers what to ask the person (`Pending`), or —
    for a request that is wrong in a way the client can be told about — the URL to send
    the browser back with. A request whose client or redirect URI cannot be trusted
    raises `PageError`: sending the browser anywhere would be the open redirect."""
    client = await client_for(params.get("client_id", ""))
    named = params.get("redirect_uri")
    redirect_uri = named or (client.redirect_uris[0] if len(client.redirect_uris) == 1 else "")
    if not redirect_uri or not redirect_matches(client.redirect_uris, redirect_uri):
        raise PageError(
            "The app asked to return somewhere it never registered, so it was not sent."
        )
    state = params.get("state")
    if params.get("response_type") != "code":
        return _refusal(redirect_uri, state, "unsupported_response_type", "Only code.")
    challenge_ = params.get("code_challenge") or ""
    if params.get("code_challenge_method") != "S256" or not _CHALLENGE.match(challenge_):
        return _refusal(redirect_uri, state, "invalid_request", "PKCE with S256 is required.")
    asked_for = params.get("resource")
    if asked_for and asked_for.rstrip("/").lower() != resource().lower():
        return _refusal(redirect_uri, state, "invalid_target", f"This server is {resource()}.")
    # A scope this server does not have is ignored rather than refused (RFC 6749 §3.3
    # lets it grant less than was asked); the token response says what was granted.
    wanted = (params.get("scope") or "").split()
    scopes = ["read", "write"] if "write" in wanted else ["read"]
    pending = Pending(
        id=new_id(),
        client_pk=client.id,
        client_id=client.client_id,
        client_name=client.client_name,
        vouched_by=client.vouched_by,
        redirect_uri=redirect_uri,
        redirect_given=bool(named),
        state=state,
        code_challenge=challenge_,
        scopes=scopes,
        user_id=user_id,
        workspace_id=workspace_id,
    )
    await redis.set(f"oauth:request:{pending.id}", json.dumps(asdict(pending)), ex=REQUEST_TTL_SEC)
    return pending


async def pending_for(request_id: str, user_id: str) -> Pending:
    raw = await redis.get(f"oauth:request:{request_id}")
    if raw is None:
        raise PageError("This request has expired. Start again from the app.")
    pending = Pending(**json.loads(raw))
    if pending.user_id != user_id:
        raise PageError("This request is somebody else's.")
    return pending


async def decide(
    request_id: str,
    *,
    user_id: str,
    approve: bool,
    write: bool,
    actor: audit_service.Actor,
) -> str:
    """The person's answer. Yes mints (or widens) their grant to this client and a code;
    either way, the answer is the URL to send the browser back to. The request is spent."""
    # Whose it is first, so a request id that reached somebody else cannot be spent by
    # them; then taken, so a double click answers once.
    await pending_for(request_id, user_id)
    raw = await redis.getdel(f"oauth:request:{request_id}")
    if raw is None:
        raise PageError("This request has expired. Start again from the app.")
    pending = Pending(**json.loads(raw))
    if not approve:
        return _refusal(pending.redirect_uri, pending.state, "access_denied", "The person said no.")
    scopes = ["read", "write"] if write and "write" in pending.scopes else ["read"]
    async with transaction() as (session, _after):
        grant_id = (
            await session.execute(
                text(
                    """
                    SELECT id FROM oauth_grants
                     WHERE user_id = :user AND client_id = :client AND revoked_at IS NULL
                     ORDER BY created_at DESC LIMIT 1
                    """
                ),
                {"user": user_id, "client": pending.client_pk},
            )
        ).scalar_one_or_none()
        if grant_id is None:
            grant_id = new_id()
            await session.execute(
                text(
                    """
                    INSERT INTO oauth_grants (id, workspace_id, user_id, client_id, scopes)
                    VALUES (:id, :ws, :user, :client, :scopes)
                    """
                ),
                {
                    "id": grant_id,
                    "ws": pending.workspace_id,
                    "user": user_id,
                    "client": pending.client_pk,
                    "scopes": scopes,
                },
            )
        else:
            await session.execute(
                text("UPDATE oauth_grants SET scopes = :scopes WHERE id = :id"),
                {"id": grant_id, "scopes": scopes},
            )
        await audit_service.record(
            session,
            actor,
            "oauth.granted",
            target_type="oauth_grant",
            target_id=str(grant_id),
            metadata={"client": pending.client_name, "scopes": scopes},
        )
    code = new_token()
    await redis.set(
        f"oauth:code:{hash_token(code)}",
        json.dumps(
            {
                "grant_id": str(grant_id),
                "client_id": pending.client_id,
                "redirect_uri": pending.redirect_uri,
                "redirect_given": pending.redirect_given,
                "code_challenge": pending.code_challenge,
                "scopes": scopes,
            }
        ),
        ex=CODE_TTL_SEC,
    )
    return answer_url(pending.redirect_uri, {"code": code, "state": pending.state})


# ─── the token endpoint ──────────────────────────────────────────────────────────────


def _pkce_ok(verifier: str, challenge_: str) -> bool:
    if not _VERIFIER.match(verifier):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii") == challenge_


async def exchange_code(form: Mapping[str, str]) -> dict[str, Any]:
    code = form.get("code") or ""
    raw = await redis.getdel(f"oauth:code:{hash_token(code)}") if code else None
    if raw is None:
        raise OAuthError("invalid_grant", "That code is unknown, used or expired.")
    held = json.loads(raw)
    if form.get("client_id") != held["client_id"]:
        raise OAuthError("invalid_grant", "That code was issued to another client.")
    presented = form.get("redirect_uri")
    if (presented or held["redirect_given"]) and presented != held["redirect_uri"]:
        raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request.")
    if not _pkce_ok(form.get("code_verifier") or "", held["code_challenge"]):
        raise OAuthError("invalid_grant", "The code verifier does not match.")
    asked_for = form.get("resource")
    if asked_for and asked_for.rstrip("/").lower() != resource().lower():
        raise OAuthError("invalid_target", f"This server is {resource()}.")
    async with transaction() as (session, _after):
        grant = await _live_grant(session, held["grant_id"])
        if grant is None:
            raise OAuthError("invalid_grant", "That connection has been revoked.")
        return await _mint(session, grant, list(held["scopes"]))


async def refresh(form: Mapping[str, str]) -> dict[str, Any]:
    token = form.get("refresh_token") or ""
    asked_for = form.get("resource")
    if asked_for and asked_for.rstrip("/").lower() != resource().lower():
        raise OAuthError("invalid_target", f"This server is {resource()}.")
    replayed: str | None = None
    async with transaction() as (session, _after):
        row = (
            await session.execute(
                text(
                    """
                    SELECT r.id, r.grant_id, r.used_at, r.expires_at <= now() AS expired,
                           c.client_id
                      FROM oauth_refresh_tokens r
                      JOIN oauth_grants g ON g.id = r.grant_id
                      JOIN oauth_clients c ON c.id = g.client_id
                     WHERE r.token_hash = :hash
                       FOR UPDATE OF r
                    """
                ),
                {"hash": hash_token(token)},
            )
        ).first()
        if row is None or form.get("client_id") != row.client_id:
            raise OAuthError("invalid_grant", "That refresh token is unknown.")
        if row.used_at is not None:
            replayed = str(row.grant_id)
        else:
            if row.expired:
                raise OAuthError("invalid_grant", "That refresh token has expired.")
            grant = await _live_grant(session, str(row.grant_id))
            if grant is None:
                raise OAuthError("invalid_grant", "That connection has been revoked.")
            await session.execute(
                text("UPDATE oauth_refresh_tokens SET used_at = now() WHERE id = :id"),
                {"id": row.id},
            )
            scopes = list(grant.scopes)
            narrowed = (form.get("scope") or "").split()
            if narrowed:
                if not set(narrowed) <= set(scopes):
                    # Raised inside the transaction, so the link is not spent by asking.
                    raise OAuthError("invalid_scope", "A refresh cannot widen what was allowed.")
                scopes = ["read", "write"] if "write" in narrowed else ["read"]
            return await _mint(session, grant, scopes)
    # A used link presented again is a stolen chain being replayed — or the real client
    # after the thief. Either way the grant can no longer be trusted, and ending it has
    # to commit on its own: the refusal that follows would roll back anything beside it.
    async with transaction() as (session, _after):
        await _end_grant(session, replayed)
    log.warning("a spent refresh token was presented again; connection %s ended", replayed)
    raise OAuthError("invalid_grant", "That refresh token was already used.")


async def _live_grant(session: AsyncSession, grant_id: str) -> Any:
    return (
        await session.execute(
            text(
                """
                SELECT g.id, g.workspace_id, g.user_id, g.scopes, c.client_name
                  FROM oauth_grants g
                  JOIN oauth_clients c ON c.id = g.client_id
                  JOIN users u ON u.id = g.user_id
                 WHERE g.id = :id AND g.revoked_at IS NULL AND u.deactivated_at IS NULL
                """
            ),
            {"id": grant_id},
        )
    ).first()


async def _mint(session: AsyncSession, grant: Any, scopes: list[str]) -> dict[str, Any]:
    access, refresh_token = new_token(), new_token()
    await session.execute(
        text(
            """
            INSERT INTO mcp_tokens
                   (id, workspace_id, user_id, name, token_hash, scopes, expires_at, grant_id)
            VALUES (:id, :ws, :user, :name, :hash, :scopes,
                    now() + make_interval(secs => :ttl), :grant)
            """
        ),
        {
            "id": new_id(),
            "ws": grant.workspace_id,
            "user": grant.user_id,
            "name": grant.client_name,
            "hash": hash_token(access),
            "scopes": scopes,
            "ttl": ACCESS_TTL_SEC,
            "grant": grant.id,
        },
    )
    await session.execute(
        text(
            """
            INSERT INTO oauth_refresh_tokens (id, grant_id, token_hash, expires_at)
            VALUES (:id, :grant, :hash, now() + make_interval(days => :days))
            """
        ),
        {
            "id": new_id(),
            "grant": grant.id,
            "hash": hash_token(refresh_token),
            "days": REFRESH_TTL_DAYS,
        },
    )
    await session.execute(
        text("UPDATE oauth_grants SET last_used_at = now() WHERE id = :id"), {"id": grant.id}
    )
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TTL_SEC,
        "refresh_token": refresh_token,
        "scope": " ".join(scopes),
    }


async def _end_grant(session: AsyncSession, grant_id: str) -> None:
    """A grant, and everything it minted, stops working at once."""
    await session.execute(
        text("UPDATE oauth_grants SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL"),
        {"id": grant_id},
    )
    await session.execute(
        text(
            "UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = :id AND revoked_at IS NULL"
        ),
        {"id": grant_id},
    )


async def revoke_token(token: str) -> None:
    """RFC 7009: a refresh token ends its grant; an access token ends itself. Anything else
    — unknown, already revoked — is answered the same, as the RFC asks."""
    if not token:
        return
    digest = hash_token(token)
    async with transaction() as (session, _after):
        grant_id = (
            await session.execute(
                text("SELECT grant_id FROM oauth_refresh_tokens WHERE token_hash = :hash"),
                {"hash": digest},
            )
        ).scalar_one_or_none()
        if grant_id is not None:
            await _end_grant(session, str(grant_id))
            return
        await session.execute(
            text(
                """
                UPDATE mcp_tokens SET revoked_at = now()
                 WHERE token_hash = :hash AND grant_id IS NOT NULL AND revoked_at IS NULL
                """
            ),
            {"hash": digest},
        )


# ─── what people see of their connections ────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class GrantView:
    id: str
    user_id: str
    owner_name: str
    client_name: str
    vouched_by: str | None
    scopes: list[str]
    created_at: Any
    last_used_at: Any


#: A grant's last use is its newest token's: a token is used on every request, while the
#: grant itself is touched only when a token is minted.
_GRANTS = """
    SELECT g.id, g.user_id, g.scopes, g.created_at, u.display_name AS owner_name,
           GREATEST(g.last_used_at,
                    (SELECT max(t.last_used_at) FROM mcp_tokens t WHERE t.grant_id = g.id)
           ) AS last_used_at,
           c.client_name, c.client_id, c.kind
      FROM oauth_grants g
      JOIN oauth_clients c ON c.id = g.client_id
      JOIN users u ON u.id = g.user_id
"""


def _grant(row: Any) -> GrantView:
    return GrantView(
        id=str(row.id),
        user_id=str(row.user_id),
        owner_name=row.owner_name,
        client_name=row.client_name,
        vouched_by=urlparse(row.client_id).hostname if row.kind == "metadata" else None,
        scopes=list(row.scopes),
        created_at=row.created_at,
        last_used_at=row.last_used_at,
    )


async def grants_of(session: AsyncSession, user_id: str) -> list[GrantView]:
    rows = (
        await session.execute(
            text(
                _GRANTS
                + " WHERE g.user_id = :user AND g.revoked_at IS NULL ORDER BY g.created_at DESC"
            ),
            {"user": user_id},
        )
    ).fetchall()
    return [_grant(row) for row in rows]


async def grants_in(session: AsyncSession, workspace_id: str) -> list[GrantView]:
    """Every live connection in the workspace — an admin's view, as for pasted tokens."""
    rows = (
        await session.execute(
            text(
                _GRANTS
                + " WHERE g.workspace_id = :ws AND g.revoked_at IS NULL ORDER BY g.created_at DESC"
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return [_grant(row) for row in rows]


async def end_grant(
    session: AsyncSession,
    grant_id: str,
    *,
    workspace_id: str,
    user_id: str | None,
    actor: audit_service.Actor,
) -> None:
    """Disconnect: a person their own (`user_id`), an admin any in the workspace (None)."""
    found = (
        await session.execute(
            text(
                """
                SELECT id FROM oauth_grants
                 WHERE id = :id AND workspace_id = :ws AND revoked_at IS NULL
                   AND (CAST(:user AS uuid) IS NULL OR user_id = CAST(:user AS uuid))
                """
            ),
            {"id": grant_id, "ws": workspace_id, "user": user_id},
        )
    ).first()
    if found is None:
        raise not_found("That connection is already gone.")
    await _end_grant(session, grant_id)
    await audit_service.record(
        session, actor, "oauth.revoked", target_type="oauth_grant", target_id=grant_id
    )


async def sweep(session: AsyncSession) -> int:
    """Expired access tokens a grant minted, refresh links used or expired a day ago — an
    hour-long token is minted many times a day and is nobody's to keep — and clients
    that registered and were never connected."""
    tokens = (
        await session.execute(
            text(
                """
                DELETE FROM mcp_tokens
                 WHERE grant_id IS NOT NULL AND expires_at < now() - interval '1 day'
                RETURNING id
                """
            )
        )
    ).fetchall()
    links = (
        await session.execute(
            text(
                """
                DELETE FROM oauth_refresh_tokens
                 WHERE (used_at IS NOT NULL AND used_at < now() - interval '1 day')
                    OR expires_at < now() - interval '1 day'
                RETURNING id
                """
            )
        )
    ).fetchall()
    # Registration is open to anyone, so a client nobody connected within a month is an
    # abandoned one; a connection's client stays for as long as the connection does.
    clients = (
        await session.execute(
            text(
                """
                DELETE FROM oauth_clients c
                 WHERE c.created_at < now() - interval '30 days'
                   AND NOT EXISTS (SELECT 1 FROM oauth_grants g
                                    WHERE g.client_id = c.id AND g.revoked_at IS NULL)
                RETURNING id
                """
            )
        )
    ).fetchall()
    return len(tokens) + len(links) + len(clients)


__all__ = [
    "ACCESS_TTL_SEC",
    "SCOPES",
    "Client",
    "GrantView",
    "OAuthError",
    "PageError",
    "Pending",
    "acceptable_redirect",
    "answer_url",
    "authorization_server_metadata",
    "begin",
    "challenge",
    "client_for",
    "decide",
    "end_grant",
    "exchange_code",
    "grants_in",
    "grants_of",
    "issuer",
    "open_client",
    "pending_for",
    "protected_resource_metadata",
    "redirect_matches",
    "refresh",
    "register",
    "resource",
    "resource_metadata_url",
    "revoke_token",
    "sweep",
]
