"""Every response carries the hardening headers, and one policy governs the app.

Before this the only Content-Security-Policy in the codebase was on the feedback snapshot.
These pin the shape of the one that now covers everything: what it allows and why (the
storage origin for uploads and attachment redirects, remote images for link previews),
where it is deliberately absent (the CDN-backed API docs), and that a route with a stricter
policy of its own keeps it.
"""

from __future__ import annotations

import pytest
from starlette.datastructures import MutableHeaders

from blob_api.config import settings
from blob_api.lib import security_headers as sh

from .helpers import Client, sign_up


def _policy(header: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for directive in header.split(";"):
        name, _, value = directive.strip().partition(" ")
        if name:
            out[name] = value
    return out


class TestThePolicyItself:
    def test_scripts_come_only_from_this_origin(self) -> None:
        policy = _policy(
            sh.content_security_policy(public_url="https://chat.example.com", storage_origin=None)
        )
        assert policy["script-src"] == "'self'"
        assert policy["object-src"] == "'none'"
        assert policy["frame-ancestors"] == "'none'"
        assert policy["base-uri"] == "'self'"

    def test_uploads_and_attachment_redirects_reach_object_storage(self) -> None:
        # Uploads are a presigned PUT straight from the browser, and downloads are a 302
        # to the same origin — CSP checks the redirect target, so both need it.
        policy = _policy(
            sh.content_security_policy(
                public_url="https://chat.example.com", storage_origin="https://files.example.com"
            )
        )
        assert "https://files.example.com" in policy["connect-src"].split()
        assert "https:" in policy["img-src"].split()
        assert "https:" in policy["media-src"].split()

    def test_the_socket_is_allowed_by_scheme_too(self) -> None:
        policy = _policy(
            sh.content_security_policy(public_url="https://chat.example.com", storage_origin=None)
        )
        assert "wss://chat.example.com" in policy["connect-src"].split()
        plain = _policy(
            sh.content_security_policy(public_url="http://localhost:3000", storage_origin=None)
        )
        assert "ws://localhost:3000" in plain["connect-src"].split()

    def test_extra_sources_widen_connect_and_images_only(self) -> None:
        policy = _policy(
            sh.content_security_policy(
                public_url="https://chat.example.com",
                storage_origin=None,
                extra_sources=["https://cdn.example.net", ""],
            )
        )
        assert "https://cdn.example.net" in policy["connect-src"].split()
        assert "https://cdn.example.net" in policy["img-src"].split()
        assert policy["script-src"] == "'self'"

    def test_a_route_with_its_own_policy_keeps_it(self) -> None:
        existing = MutableHeaders(headers={"content-security-policy": "default-src 'none'"})
        added = sh.security_headers(path="/api/feedback/x/snapshot", secure=True, existing=existing)
        assert "content-security-policy" not in added
        assert added["x-content-type-options"] == "nosniff"

    def test_the_api_docs_get_every_header_but_the_policy(self) -> None:
        added = sh.security_headers(path="/docs", secure=True, existing=MutableHeaders())
        assert "content-security-policy" not in added
        assert added["x-frame-options"] == "DENY"

    def test_hsts_only_over_https(self) -> None:
        secure = sh.security_headers(path="/", secure=True, existing=MutableHeaders())
        plain = sh.security_headers(path="/", secure=False, existing=MutableHeaders())
        assert secure["strict-transport-security"] == sh.HSTS
        assert "strict-transport-security" not in plain


class TestOnTheWire:
    async def test_an_api_response_carries_them(self, client: Client) -> None:
        answer = await client.get("/healthz")
        assert answer.headers.get("x-content-type-options") == "nosniff"
        assert answer.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
        assert answer.headers.get("x-frame-options") == "DENY"
        assert "script-src 'self'" in answer.headers.get("content-security-policy", "")

    async def test_so_does_a_refusal_from_the_session_middleware(self, client: Client) -> None:
        # The 401 is written by SessionMiddleware itself, so the headers middleware has to
        # sit outside it or the one response an attacker sees most goes out bare.
        answer = await client.get("/api/bootstrap")
        assert answer.status == 401
        assert answer.headers.get("x-content-type-options") == "nosniff"
        assert "content-security-policy" in answer.headers

    async def test_the_docs_page_is_exempt_from_the_policy(self, client: Client) -> None:
        answer = await client.get("/docs")
        assert answer.status == 200
        assert "content-security-policy" not in answer.headers
        assert answer.headers.get("x-content-type-options") == "nosniff"

    async def test_a_signed_in_response_carries_them_too(self, client: Client) -> None:
        owner = await sign_up(client, "Owner")
        answer = await owner.get("/api/channels")
        assert answer.status == 200
        assert "content-security-policy" in answer.headers

    async def test_the_switch_turns_it_off(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SECURITY_HEADERS", False)
        answer = await client.get("/healthz")
        assert "content-security-policy" not in answer.headers
        assert "x-content-type-options" not in answer.headers
