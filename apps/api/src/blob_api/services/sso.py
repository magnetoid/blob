"""Single sign-on with OpenID Connect (M3 · B1, ADR 0033).

Blob is the relying party; a company's identity provider — Google Workspace, Microsoft
Entra, Okta, Keycloak, anything that speaks OIDC — says who is signing in. The flow is the
authorization code flow with PKCE (S256), a nonce and a state; the `iss` parameter is
checked where the provider sends it (RFC 9207), and the ID token's signature is checked
against the provider's published keys, never its claims taken on trust.

Who that is, in Blob, is decided by the pair (provider, `sub`) and by nothing else once the
pair is known. The first time a subject arrives it is linked to an address only on a claim
the provider *verified* — `email_verified` exactly `true`, not merely present — only within
the domains the administrator allowed, and only when that address has no other subject at
the same provider: the three mistakes behind 2026's OIDC account takeovers (Coder's
CVE-2026-55075, Keycloak's CVE-2026-14781). A provider can be told never to link by email;
then a person links it themselves, signed in, from Sign-in & security.

A provider is the *server's*, connected by its administrator, like the address it sits
at: one person is one address across every workspace here (ADR 0031), so the provider
that vouches for them is too.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import asdict, dataclass
from typing import Any, Literal
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.errors import AppError, bad_request, conflict, not_found, unique_violation
from ..lib.ids import new_id, new_token
from ..lib.redis import redis

Intent = Literal["sign_in", "confirm", "link"]

#: How long the round trip through the provider may take, from the button to the callback.
FLOW_SEC = 600

#: How long a discovery document and a key set are trusted before they are fetched again.
#: A provider rotating its keys is caught sooner than this: an unknown `kid` refetches.
CACHE_SEC = 3600

#: Signature algorithms an ID token may use. Asymmetric only: a symmetric one would make
#: the client secret the signing key, and `none` is no signature at all.
ALGORITHMS = frozenset(
    {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}
)

#: How far a provider's clock may be from ours.
LEEWAY_SEC = 60

#: How recent a sign-in at the provider must be to confirm it is you here (`max_age=0`
#: asks for a fresh one; this is what "fresh" is allowed to mean, clocks included).
CONFIRM_FRESH_SEC = 300


class SsoError(Exception):
    """A sign-in through a provider that did not go through, with a code the sign-in page
    turns into a sentence. Never raised as an HTTP error: the browser is mid-redirect."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


@dataclass(slots=True, frozen=True)
class Provider:
    id: str
    slug: str
    name: str
    issuer: str
    client_id: str
    scopes: str
    allowed_domains: tuple[str, ...]
    link_by_email: bool
    join_workspace_id: str | None
    enabled: bool

    def allows(self, email: str) -> bool:
        if not self.allowed_domains:
            return True
        return email.rsplit("@", 1)[-1].lower() in self.allowed_domains


_PROVIDER_COLUMNS = """
    p.id, p.slug, p.name, p.issuer, p.client_id, p.scopes, p.allowed_domains,
    p.link_by_email, p.join_workspace_id, p.enabled
"""


def _provider(row: Any) -> Provider:
    return Provider(
        id=str(row.id),
        slug=row.slug,
        name=row.name,
        issuer=row.issuer,
        client_id=row.client_id,
        scopes=row.scopes,
        allowed_domains=tuple(domain.lower() for domain in row.allowed_domains or ()),
        link_by_email=bool(row.link_by_email),
        join_workspace_id=str(row.join_workspace_id) if row.join_workspace_id else None,
        enabled=bool(row.enabled),
    )


async def enabled_providers(session: AsyncSession) -> list[Provider]:
    rows = (
        await session.execute(
            text(f"SELECT {_PROVIDER_COLUMNS} FROM sso_providers p WHERE p.enabled ORDER BY p.name")
        )
    ).fetchall()
    return [_provider(row) for row in rows]


async def all_providers(session: AsyncSession) -> list[Provider]:
    rows = (
        await session.execute(
            text(f"SELECT {_PROVIDER_COLUMNS} FROM sso_providers p ORDER BY p.name")
        )
    ).fetchall()
    return [_provider(row) for row in rows]


async def provider_by(
    session: AsyncSession, *, slug: str | None = None, provider_id: str | None = None
) -> Provider | None:
    row = (
        await session.execute(
            text(
                f"""
                SELECT {_PROVIDER_COLUMNS} FROM sso_providers p
                 WHERE (cast(:slug AS text) IS NULL OR p.slug = :slug)
                   AND (cast(:id AS uuid) IS NULL OR p.id = cast(:id AS uuid))
                """
            ),
            {"slug": slug, "id": provider_id},
        )
    ).fetchone()
    return _provider(row) if row else None


async def _client_secret(session: AsyncSession, provider_id: str) -> str | None:
    row = (
        await session.execute(
            text("SELECT client_secret FROM sso_provider_secrets WHERE provider_id = :id"),
            {"id": provider_id},
        )
    ).fetchone()
    return str(row.client_secret) if row else None


def callback_url() -> str:
    """Where every provider sends the browser back. The administrator registers this one
    address at the provider, once, whatever the provider is called here."""
    return f"{settings.PUBLIC_URL.rstrip('/')}/api/auth/sso/callback"


# ─── talking to the provider ──────────────────────────────────────────────────


def http_client() -> httpx.AsyncClient:
    """Every request Blob makes to an identity provider. The seam the tests replace."""
    return httpx.AsyncClient(timeout=10.0, follow_redirects=False)


_discovered: dict[str, tuple[float, dict[str, Any]]] = {}
_key_sets: dict[str, tuple[float, jwt.PyJWKSet]] = {}


def forget_cached() -> None:
    """For the tests, and for an administrator who has just changed a provider."""
    _discovered.clear()
    _key_sets.clear()


def _endpoint_ok(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return True
    # A provider on this machine during development — never in production.
    return (
        not settings.is_prod
        and parsed.scheme == "http"
        and parsed.hostname in {"localhost", "127.0.0.1"}
    )


async def discover(issuer: str) -> dict[str, Any]:
    """The provider's own description of itself (OIDC Discovery 1.0), checked.

    The document has to name the same issuer it was fetched for — the check that stops a
    document at one address from speaking for another — and every endpoint in it has to be
    https outside development.
    """
    cached = _discovered.get(issuer)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    if not _endpoint_ok(issuer):
        raise SsoError("misconfigured", "The issuer must be an https address.")
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    try:
        async with http_client() as http:
            response = await http.get(url, headers={"accept": "application/json"})
        document = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError) as error:
        raise SsoError("unreachable", str(error)) from error
    if not isinstance(document, dict):
        raise SsoError("unreachable", f"{url} answered {response.status_code}.")
    if document.get("issuer") != issuer:
        raise SsoError(
            "misconfigured", f"The provider says its issuer is {document.get('issuer')!r}."
        )
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not _endpoint_ok(document.get(key)):
            raise SsoError("misconfigured", f"The provider's {key} is missing or not https.")
    _discovered[issuer] = (time.monotonic() + CACHE_SEC, document)
    return document


async def normalize_issuer(typed: str) -> str:
    """The issuer exactly as the provider writes it, from what an administrator typed.

    Issuers are compared character for character, and providers disagree about a trailing
    slash (Auth0 has one, Google does not). Asking the provider settles it once, at setup,
    instead of failing every sign-in afterwards.
    """
    typed = typed.strip()
    if not _endpoint_ok(typed):
        raise bad_request("The issuer must be an https address.", code="sso_issuer_invalid")
    url = typed.rstrip("/") + "/.well-known/openid-configuration"
    try:
        async with http_client() as http:
            response = await http.get(url, headers={"accept": "application/json"})
        document = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError) as error:
        raise bad_request(
            f"Could not read {url}: {error}", code="sso_issuer_unreachable"
        ) from error
    if not isinstance(document, dict) or not isinstance(document.get("issuer"), str):
        raise bad_request(
            f"{url} is not an OpenID Connect discovery document.", code="sso_issuer_unreachable"
        )
    issuer = str(document["issuer"])
    if issuer.rstrip("/") != typed.rstrip("/"):
        raise bad_request(
            f"That address says its issuer is {issuer}. Use that instead.",
            code="sso_issuer_mismatch",
        )
    forget_cached()
    await discover(issuer)
    return issuer


async def _keys(jwks_uri: str, *, fresh: bool = False) -> jwt.PyJWKSet:
    cached = _key_sets.get(jwks_uri)
    if cached and cached[0] > time.monotonic() and not fresh:
        return cached[1]
    try:
        async with http_client() as http:
            response = await http.get(jwks_uri, headers={"accept": "application/json"})
        key_set = jwt.PyJWKSet.from_dict(response.json())
    except (httpx.HTTPError, ValueError, jwt.PyJWTError) as error:
        raise SsoError("unreachable", f"The provider's keys could not be read: {error}") from error
    _key_sets[jwks_uri] = (time.monotonic() + CACHE_SEC, key_set)
    return key_set


async def _signing_key(jwks_uri: str, kid: str | None) -> jwt.PyJWK:
    for fresh in (False, True):
        key_set = await _keys(jwks_uri, fresh=fresh)
        if kid is None:
            if len(key_set.keys) == 1:
                return key_set.keys[0]
        else:
            for key in key_set.keys:
                if key.key_id == kid:
                    return key
    raise SsoError("invalid_token", "No published key matches the token.")


async def verify_id_token(
    provider: Provider, document: dict[str, Any], id_token: str, *, nonce: str
) -> dict[str, Any]:
    """The ID token's claims, once its signature, issuer, audience, times and nonce check
    out (OIDC Core §3.1.3.7)."""
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as error:
        raise SsoError("invalid_token", str(error)) from error
    algorithm = header.get("alg")
    offered = set(document.get("id_token_signing_alg_values_supported") or ["RS256"])
    if algorithm not in ALGORITHMS or algorithm not in offered:
        raise SsoError("invalid_token", f"The token is signed with {algorithm!r}.")
    key = await _signing_key(str(document["jwks_uri"]), header.get("kid"))
    try:
        claims: dict[str, Any] = jwt.decode(
            id_token,
            key=key.key,
            algorithms=[algorithm],
            audience=provider.client_id,
            issuer=provider.issuer,
            leeway=LEEWAY_SEC,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise SsoError("invalid_token", str(error)) from error
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise SsoError("invalid_token", "The token answers another sign-in.")
    audience = claims["aud"]
    authorized = claims.get("azp")
    if isinstance(audience, list) and len(audience) > 1 and authorized is None:
        raise SsoError("invalid_token", "The token names several audiences and no party.")
    if authorized is not None and authorized != provider.client_id:
        raise SsoError("invalid_token", "The token was issued to another client.")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise SsoError("invalid_token", "The token names nobody.")
    return claims


async def _exchange(
    session: AsyncSession, provider: Provider, document: dict[str, Any], code: str, verifier: str
) -> dict[str, Any]:
    """Trade the code for tokens at the token endpoint, as this client."""
    secret = await _client_secret(session, provider.id)
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": callback_url(),
        "code_verifier": verifier,
    }
    extra: dict[str, Any] = {}
    methods = document.get("token_endpoint_auth_methods_supported") or ["client_secret_basic"]
    if secret is None:
        form["client_id"] = provider.client_id
    elif "client_secret_basic" in methods:
        # RFC 6749 §2.3.1: each half is form-encoded before it goes into the header.
        extra["auth"] = httpx.BasicAuth(quote(provider.client_id, safe=""), quote(secret, safe=""))
    else:
        form["client_id"] = provider.client_id
        form["client_secret"] = secret
    try:
        async with http_client() as http:
            response = await http.post(
                str(document["token_endpoint"]),
                data=form,
                headers={"accept": "application/json"},
                **extra,
            )
        body = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise SsoError("unreachable", str(error)) from error
    if response.status_code != 200 or not isinstance(body, dict):
        raise SsoError("denied", str(body.get("error") if isinstance(body, dict) else body))
    if not isinstance(body.get("id_token"), str):
        raise SsoError("invalid_token", "The provider sent no ID token.")
    return body


# ─── the round trip ───────────────────────────────────────────────────────────


@dataclass(slots=True)
class Flow:
    provider_id: str
    intent: Intent
    nonce: str
    verifier: str
    next_path: str
    #: The session asking, for a confirmation or a link; none for a sign-in.
    session_id: str | None = None
    #: An invitation the person arrived with, to join by.
    invite_token: str | None = None


def _flow_key(state: str) -> str:
    return f"sso:flow:{state}"


def safe_next(path: str | None) -> str:
    """Where to land afterwards: a path on this server, or the root. Never a URL — the
    one place a sign-in could be turned into an open redirect."""
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path[:512]


async def begin(
    provider: Provider,
    *,
    intent: Intent,
    next_path: str | None,
    session_id: str | None,
    invite_token: str | None,
) -> tuple[str, str]:
    """A new round trip: the state to bind to this browser, and where to send it."""
    document = await discover(provider.issuer)
    state = new_token()
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    flow = Flow(
        provider_id=provider.id,
        intent=intent,
        nonce=new_token(),
        verifier=verifier,
        next_path=safe_next(next_path),
        session_id=session_id,
        invite_token=invite_token,
    )
    await redis.set(_flow_key(state), json.dumps(asdict(flow)), ex=FLOW_SEC)
    params = {
        "response_type": "code",
        "client_id": provider.client_id,
        "redirect_uri": callback_url(),
        "scope": provider.scopes,
        "state": state,
        "nonce": flow.nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if intent == "confirm":
        # Ask the provider to sign the person in again rather than wave them through on
        # a session it already has — otherwise "confirm it's you" proves only a cookie.
        params["prompt"] = "login"
        params["max_age"] = "0"
    endpoint = str(document["authorization_endpoint"])
    return state, f"{endpoint}{'&' if '?' in endpoint else '?'}{urlencode(params)}"


async def abandon(state: str) -> None:
    """A round trip the person ended at the provider: its state is spent all the same."""
    await redis.delete(_flow_key(state))


async def finish(
    session: AsyncSession, *, state: str, code: str, iss: str | None
) -> tuple[Flow, Provider, dict[str, Any]]:
    """Spend the state, trade the code, and answer the verified claims."""
    raw = await redis.getdel(_flow_key(state))
    if not raw:
        raise SsoError("expired")
    flow = Flow(**json.loads(raw))
    provider = await provider_by(session, provider_id=flow.provider_id)
    if provider is None or not provider.enabled:
        raise SsoError("unavailable")
    document = await discover(provider.issuer)
    # RFC 9207: which provider is answering, stated by the provider. Where it says it
    # always sends this, a missing one is as wrong as a different one.
    if iss is not None and iss != provider.issuer:
        raise SsoError("invalid_token", "The answer came from another issuer.")
    if iss is None and document.get("authorization_response_iss_parameter_supported") is True:
        raise SsoError("invalid_token", "The answer did not say which issuer sent it.")
    tokens = await _exchange(session, provider, document, code, flow.verifier)
    claims = await verify_id_token(provider, document, tokens["id_token"], nonce=flow.nonce)
    if flow.intent == "confirm":
        signed_in_at = claims.get("auth_time")
        if not isinstance(signed_in_at, (int, float)) or time.time() - signed_in_at > (
            CONFIRM_FRESH_SEC + LEEWAY_SEC
        ):
            raise SsoError("stale", "The provider did not ask you to sign in again.")
    return flow, provider, claims


# ─── who it is ────────────────────────────────────────────────────────────────


async def linked_address(session: AsyncSession, provider: Provider, subject: str) -> str | None:
    row = (
        await session.execute(
            text(
                """
                UPDATE sso_identities SET last_used_at = now()
                 WHERE provider_id = :provider AND subject = :subject
                RETURNING email
                """
            ),
            {"provider": provider.id, "subject": subject},
        )
    ).fetchone()
    return str(row.email) if row else None


def verified_email(claims: dict[str, Any]) -> str | None:
    """The address the provider vouches for, or None. `email_verified` has to be the JSON
    value `true` — a missing claim, the string "true" or a 1 is no vouching at all."""
    email = claims.get("email")
    if claims.get("email_verified") is not True or not isinstance(email, str) or "@" not in email:
        return None
    return email.strip().lower()


def display_name(claims: dict[str, Any], email: str) -> str:
    """What a new person is called here: what the provider calls them, or their address's
    first half. Trimmed to the display name's limit; the signup seam makes it unique."""
    for candidate in (
        claims.get("name"),
        " ".join(
            str(part) for part in (claims.get("given_name"), claims.get("family_name")) if part
        ),
        claims.get("preferred_username"),
    ):
        if isinstance(candidate, str) and candidate.strip() and "@" not in candidate:
            return candidate.strip()[:40]
    return email.split("@", 1)[0][:40] or "New member"


async def link(session: AsyncSession, provider: Provider, *, subject: str, email: str) -> None:
    """This subject is this address, from now on. Refused when the address already has a
    different subject at this provider — the check whose absence was CVE-2026-55075."""
    other = (
        await session.execute(
            text(
                "SELECT subject FROM sso_identities"
                " WHERE provider_id = :provider AND email = :email"
            ),
            {"provider": provider.id, "email": email},
        )
    ).fetchone()
    if other is not None and other.subject != subject:
        raise SsoError("linked_elsewhere")
    try:
        async with session.begin_nested():
            await session.execute(
                text(
                    """
                    INSERT INTO sso_identities (provider_id, subject, email, last_used_at)
                    VALUES (:provider, :subject, :email, now())
                    ON CONFLICT (provider_id, subject) DO NOTHING
                    """
                ),
                {"provider": provider.id, "subject": subject, "email": email},
            )
    except Exception as error:
        if unique_violation(error):
            raise SsoError("linked_elsewhere") from error
        raise


async def has_account(session: AsyncSession, email: str) -> bool:
    row = (
        await session.execute(
            text("SELECT 1 FROM users WHERE email = :email AND kind = 'human' LIMIT 1"),
            {"email": email},
        )
    ).fetchone()
    return row is not None


async def identities_of(session: AsyncSession, email: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT p.id, p.slug, p.name, i.created_at, i.last_used_at
                      FROM sso_identities i JOIN sso_providers p ON p.id = i.provider_id
                     WHERE i.email = :email
                     ORDER BY p.name
                    """
                ),
                {"email": email},
            )
        ).fetchall()
    )


async def unlink(session: AsyncSession, *, email: str, provider_id: str) -> None:
    """Take a provider off this person — unless it is the only way they have left in."""
    removed = (
        await session.execute(
            text(
                """
                DELETE FROM sso_identities WHERE provider_id = :provider AND email = :email
                RETURNING subject
                """
            ),
            {"provider": provider_id, "email": email},
        )
    ).fetchone()
    if removed is None:
        raise not_found("That provider is not linked to your account.")
    other_ways = (
        await session.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM users
                                WHERE email = :email AND password_hash IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM passkeys WHERE email = :email)
                    OR EXISTS (SELECT 1 FROM sso_identities WHERE email = :email)
                """
            ),
            {"email": email},
        )
    ).scalar_one()
    if not other_ways:
        raise bad_request(
            "This is your only way to sign in. Set a password or add a passkey first.",
            code="last_way_in",
        )


# ─── the administrator's ──────────────────────────────────────────────────────


@dataclass(slots=True)
class ProviderInput:
    name: str
    issuer: str
    client_id: str
    client_secret: str | None
    scopes: str
    allowed_domains: list[str]
    link_by_email: bool
    join_workspace_id: str | None
    enabled: bool


def _clean_domains(domains: list[str], *, joins: bool) -> list[str]:
    cleaned = sorted({d.strip().lower().lstrip("@") for d in domains if d.strip()})
    for domain in cleaned:
        if "." not in domain or "/" in domain or " " in domain:
            raise bad_request(f"{domain!r} is not a domain.", code="sso_domain_invalid")
    if joins and not cleaned:
        # Letting new people in with no domain named lets in anyone the provider knows —
        # and for Google or Microsoft, that is anyone with a free account.
        raise bad_request(
            "Name the domains whose people may join without an invitation. Without them, "
            "anyone with an account at this provider could.",
            code="sso_domains_required",
        )
    return cleaned


async def create_provider(
    session: AsyncSession, *, slug: str, data: ProviderInput, created_by: str
) -> Provider:
    issuer = await normalize_issuer(data.issuer)
    provider_id = new_id()
    try:
        async with session.begin_nested():
            await session.execute(
                text(
                    """
                    INSERT INTO sso_providers
                           (id, slug, name, issuer, client_id, scopes, allowed_domains,
                            link_by_email, join_workspace_id, enabled, created_by)
                    VALUES (:id, :slug, :name, :issuer, :client_id, :scopes, :domains,
                            :link, :join, :enabled, :by)
                    """
                ),
                {
                    "id": provider_id,
                    "slug": slug,
                    "name": data.name.strip(),
                    "issuer": issuer,
                    "client_id": data.client_id.strip(),
                    "scopes": data.scopes.strip() or "openid email profile",
                    "domains": _clean_domains(
                        data.allowed_domains, joins=data.join_workspace_id is not None
                    ),
                    "link": data.link_by_email,
                    "join": data.join_workspace_id,
                    "enabled": data.enabled,
                    "by": created_by,
                },
            )
    except Exception as error:
        if unique_violation(error):
            raise conflict("A provider already has that short name.", "sso_slug_taken") from error
        raise
    if data.client_secret:
        await _set_secret(session, provider_id, data.client_secret)
    created = await provider_by(session, provider_id=provider_id)
    if created is None:
        raise bad_request("That provider could not be saved.")
    return created


async def update_provider(
    session: AsyncSession, *, provider_id: str, data: ProviderInput
) -> Provider:
    existing = await provider_by(session, provider_id=provider_id)
    if existing is None:
        raise not_found("No such provider.")
    issuer = (
        existing.issuer
        if data.issuer.strip() == existing.issuer
        else await normalize_issuer(data.issuer)
    )
    await session.execute(
        text(
            """
            UPDATE sso_providers
               SET name = :name, issuer = :issuer, client_id = :client_id, scopes = :scopes,
                   allowed_domains = :domains, link_by_email = :link,
                   join_workspace_id = :join, enabled = :enabled, updated_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": provider_id,
            "name": data.name.strip(),
            "issuer": issuer,
            "client_id": data.client_id.strip(),
            "scopes": data.scopes.strip() or "openid email profile",
            "domains": _clean_domains(
                data.allowed_domains, joins=data.join_workspace_id is not None
            ),
            "link": data.link_by_email,
            "join": data.join_workspace_id,
            "enabled": data.enabled,
        },
    )
    if data.client_secret:
        await _set_secret(session, provider_id, data.client_secret)
    forget_cached()
    updated = await provider_by(session, provider_id=provider_id)
    if updated is None:
        raise not_found("No such provider.")
    return updated


async def _set_secret(session: AsyncSession, provider_id: str, secret: str) -> None:
    await session.execute(
        text(
            """
            INSERT INTO sso_provider_secrets (provider_id, client_secret)
            VALUES (:id, :secret)
            ON CONFLICT (provider_id)
            DO UPDATE SET client_secret = EXCLUDED.client_secret, updated_at = now()
            """
        ),
        {"id": provider_id, "secret": secret},
    )


async def has_secret(session: AsyncSession, provider_id: str) -> bool:
    return await _client_secret(session, provider_id) is not None


async def delete_provider(session: AsyncSession, provider_id: str) -> None:
    deleted = (
        await session.execute(
            text("DELETE FROM sso_providers WHERE id = :id RETURNING id"), {"id": provider_id}
        )
    ).fetchone()
    if deleted is None:
        raise not_found("No such provider.")
    forget_cached()


async def linked_count(session: AsyncSession, provider_id: str) -> int:
    return int(
        (
            await session.execute(
                text("SELECT count(*) FROM sso_identities WHERE provider_id = :id"),
                {"id": provider_id},
            )
        ).scalar_one()
    )


def refusal(code: str) -> AppError:
    return AppError(400, f"sso_{code}", "Single sign-on did not go through.")
