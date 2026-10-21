"""An OpenID Connect provider in a box, for the single sign-on tests.

It does what a real one does with what Blob sends — discovery, the authorization request,
the code exchange with PKCE and client authentication, ID tokens signed with a published
RSA key — and lets a test bend any of it: a wrong nonce, another audience, a stale
`auth_time`, a rotated key. Blob reaches it through `services/sso.http_client`, which the
`idp` fixture points here.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER = "https://idp.example.com"
CLIENT_ID = "blob-client"
CLIENT_SECRET = "the-client-secret"


def _new_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@dataclass
class FakeIdP:
    issuer: str = ISSUER
    key: rsa.RSAPrivateKey = field(default_factory=_new_key)
    kid: str = "key-1"
    #: Advertise RFC 9207's `iss` parameter (and send it).
    sends_iss: bool = True
    codes: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: Applied to every ID token minted, after the honest claims — to break one on purpose.
    tamper: dict[str, Any] = field(default_factory=dict)
    algorithm: str = "RS256"
    token_requests: list[httpx.Request] = field(default_factory=list)

    # ─── what Blob fetches ────────────────────────────────────────────────────

    def discovery(self) -> dict[str, Any]:
        return {
            "issuer": self.issuer,
            "authorization_endpoint": f"{ISSUER}/authorize",
            "token_endpoint": f"{ISSUER}/token",
            "jwks_uri": f"{ISSUER}/jwks",
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"],
            "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
            "code_challenge_methods_supported": ["S256"],
            "authorization_response_iss_parameter_supported": self.sends_iss,
        }

    def jwks(self) -> dict[str, Any]:
        public = jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key(), as_dict=True)
        return {"keys": [{**public, "kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def rotate(self) -> None:
        """A new signing key under a new id, as providers do on their own schedule."""
        self.key = _new_key()
        self.kid = f"key-{secrets.token_hex(3)}"

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(200, json=self.discovery())
        if path == "/jwks":
            return httpx.Response(200, json=self.jwks())
        if path == "/token":
            self.token_requests.append(request)
            return self._token(request)
        return httpx.Response(404, json={"error": "not_found"})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    # ─── the person at the provider ───────────────────────────────────────────

    def authorize(self, url: str, claims: dict[str, Any]) -> dict[str, str]:
        """The person signs in at the provider; answers the query the provider sends the
        browser back to Blob with."""
        query = {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}
        assert query["response_type"] == "code"
        assert query["client_id"] == CLIENT_ID
        assert query["code_challenge_method"] == "S256"
        assert "openid" in query["scope"].split()
        code = secrets.token_urlsafe(16)
        self.codes[code] = {
            "redirect_uri": query["redirect_uri"],
            "challenge": query["code_challenge"],
            "nonce": query["nonce"],
            "claims": claims,
            "prompt": query.get("prompt"),
        }
        answer = {"code": code, "state": query["state"]}
        if self.sends_iss:
            answer["iss"] = self.issuer
        return answer

    def _token(self, request: httpx.Request) -> httpx.Response:
        form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        client_id, secret = form.get("client_id"), form.get("client_secret")
        header = request.headers.get("authorization", "")
        if header.startswith("Basic "):
            client_id, _, secret = base64.b64decode(header[6:]).decode().partition(":")
        if client_id != CLIENT_ID or secret != CLIENT_SECRET:
            return httpx.Response(401, json={"error": "invalid_client"})
        issued = self.codes.pop(form.get("code", ""), None)
        if issued is None or form.get("grant_type") != "authorization_code":
            return httpx.Response(400, json={"error": "invalid_grant"})
        if form.get("redirect_uri") != issued["redirect_uri"]:
            return httpx.Response(400, json={"error": "invalid_grant"})
        verifier = form.get("code_verifier", "")
        derived = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        if derived != issued["challenge"]:
            return httpx.Response(400, json={"error": "invalid_grant"})
        now = int(time.time())
        claims = {
            "iss": self.issuer,
            "aud": CLIENT_ID,
            "iat": now,
            "exp": now + 300,
            "auth_time": now,
            "nonce": issued["nonce"],
            **issued["claims"],
            **self.tamper,
        }
        claims = {key: value for key, value in claims.items() if value is not None}
        id_token = jwt.encode(
            claims,
            self.key
            if self.algorithm.startswith(("RS", "PS"))
            else "a-shared-secret-of-thirty-two-bytes!",
            algorithm=self.algorithm,
            headers={"kid": self.kid},
        )
        return httpx.Response(
            200,
            json={"access_token": "at", "token_type": "Bearer", "id_token": id_token},
            headers={"cache-control": "no-store"},
        )


def person(
    sub: str, email: str, *, verified: Any = True, name: str | None = None
) -> dict[str, Any]:
    """What the provider says about somebody."""
    claims: dict[str, Any] = {"sub": sub, "email": email, "email_verified": verified}
    if name:
        claims["name"] = name
    return claims


__all__ = ["CLIENT_ID", "CLIENT_SECRET", "ISSUER", "FakeIdP", "person"]
