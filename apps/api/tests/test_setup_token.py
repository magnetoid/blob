"""A fresh server founded only by whoever holds its setup token, when it has one (M3 · C3).

Without SETUP_TOKEN the first person to reach a fresh deploy founds its workspace and
becomes the server's administrator; with it, the first-run form asks for the token. An
invitation into a workspace that exists never needs it.
"""

from __future__ import annotations

import pytest

from blob_api.config import settings

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up

TOKEN = "setup-0123456789abcdef"


def founding(**extra: object) -> dict[str, object]:
    return {
        "email": "first@example.com",
        "password": PASSWORD,
        "displayName": "First Person",
        "workspaceName": "Fresh",
        **extra,
    }


async def test_a_server_with_a_token_says_it_asks_for_one(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SETUP_TOKEN", TOKEN)
    state = (await client.get("/api/auth/state")).body
    assert state["needsSetup"] is True and state["setupTokenRequired"] is True


async def test_founding_needs_the_token_when_there_is_one(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SETUP_TOKEN", TOKEN)
    assert (await client.post("/api/auth/signup", founding())).status == 403
    assert (await client.post("/api/auth/signup", founding(setupToken="wrong"))).status == 403
    founded = await client.post("/api/auth/signup", founding(setupToken=TOKEN))
    assert founded.status == 200, founded.body
    # Founded: nothing is asked of anybody after that.
    state = (await client.get("/api/auth/state")).body
    assert state["needsSetup"] is False and state["setupTokenRequired"] is False


async def test_an_invitation_never_needs_it(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Olga Owner")
    monkeypatch.setattr(settings, "SETUP_TOKEN", TOKEN)
    joined = await invite_and_sign_up(owner, "Max Member")
    assert joined.user_id


async def test_without_a_token_the_first_person_founds_it(client: Client) -> None:
    state = (await client.get("/api/auth/state")).body
    assert state["setupTokenRequired"] is False
    assert (await client.post("/api/auth/signup", founding())).status == 200
