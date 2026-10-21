"""The session cookie carries the `__Host-` prefix in production (M3 · C3).

A browser takes a `__Host-` cookie only from this host — Secure, `Path=/`, no `Domain` — so
a sibling subdomain, where hosted agents and storage live, cannot plant a session here.
Sessions from before the prefix still work, and the next bootstrap moves them across.

The test client talks plain HTTP, and a jar will not send a Secure cookie over it, so
these read `Set-Cookie` as written and send `Cookie` by hand.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio

from blob_api.config import settings
from blob_api.lib.auth import HOST_SESSION_COOKIE, SESSION_COOKIE, session_cookie_name

from .helpers import PASSWORD, Client, sign_up


@pytest_asyncio.fixture
async def olga(client: Client) -> dict[str, Any]:
    person = await sign_up(client, "Olga Owner")
    token = person._http.cookies.get(SESSION_COOKIE)
    assert token
    return {"client": person, "token": token}


def written(response: Any) -> dict[str, str]:
    """Each cookie the response set, by name, as its whole header line."""
    lines = response.headers.get_list("set-cookie")
    return {line.split("=", 1)[0]: line for line in lines}


def test_development_keeps_the_plain_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "NODE_ENV", "development")
    assert session_cookie_name() == SESSION_COOKIE
    monkeypatch.setattr(settings, "NODE_ENV", "production")
    assert session_cookie_name() == HOST_SESSION_COOKIE


async def test_signing_in_in_production_sets_the_prefixed_cookie_and_clears_the_plain(
    olga: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "NODE_ENV", "production")
    signed_in = await olga["client"]._http.post(
        "/api/auth/login",
        json={"email": "olga.owner@example.com", "password": PASSWORD},
        headers={"origin": settings.PUBLIC_URL, "cookie": ""},
    )
    assert signed_in.status_code == 200, signed_in.text
    cookies = written(signed_in)
    prefixed = cookies[HOST_SESSION_COOKIE].lower()
    assert "secure" in prefixed and "path=/" in prefixed and "domain=" not in prefixed
    assert "max-age=0" in cookies[SESSION_COOKIE].lower()


async def test_a_session_from_before_the_prefix_moves_across(
    olga: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "NODE_ENV", "production")
    booted = await olga["client"]._http.get(
        "/api/bootstrap", headers={"cookie": f"{SESSION_COOKIE}={olga['token']}"}
    )
    assert booted.status_code == 200
    cookies = written(booted)
    assert cookies[HOST_SESSION_COOKIE].startswith(f"{HOST_SESSION_COOKIE}={olga['token']}")
    assert "max-age=0" in cookies[SESSION_COOKIE].lower()


async def test_the_prefixed_cookie_wins_over_a_planted_plain_one(
    olga: dict[str, Any], client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What a sibling subdomain could plant is the plain name; it never displaces the real
    session."""
    monkeypatch.setattr(settings, "NODE_ENV", "production")
    booted = await olga["client"]._http.get(
        "/api/bootstrap",
        headers={
            "cookie": f"{SESSION_COOKIE}=planted-by-a-sibling; "
            f"{HOST_SESSION_COOKIE}={olga['token']}"
        },
    )
    assert booted.status_code == 200
    assert booted.json()["user"]["displayName"] == "Olga Owner"
    assert HOST_SESSION_COOKIE not in written(booted)
