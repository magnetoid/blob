"""Every request body has a ceiling, and it is checked before anything reads the body."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from blob_api.lib import body_limit

from .helpers import Client, send_message, sign_up


async def general_of(owner: Client) -> str:
    channels = (await owner.get("/api/channels")).body["channels"]
    return str(next(c for c in channels if c["name"] == "general")["id"])


async def test_a_declared_length_over_the_limit_is_refused_unread(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Owner")
    general = await general_of(owner)
    monkeypatch.setattr(body_limit, "MAX_BODY_BYTES", 512)

    response = await send_message(owner, general, "x" * 2_000)
    assert response.status == 413, response.body
    assert response.body["error"]["code"] == "payload_too_large"


async def test_a_body_with_no_length_is_counted_as_it_arrives(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Owner")
    general = await general_of(owner)
    monkeypatch.setattr(body_limit, "MAX_BODY_BYTES", 512)

    async def chunks() -> AsyncIterator[bytes]:
        yield b'{"clientMsgId": "0192f1c0-0000-7000-8000-000000000001", "body": "'
        for _ in range(20):
            yield b"x" * 100
        yield b'"}'

    response = await owner._http.post(
        f"/api/channels/{general}/messages",
        content=chunks(),
        headers={"content-type": "application/json"},
    )
    assert "content-length" not in response.request.headers
    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "payload_too_large"


async def test_an_ordinary_request_is_untouched(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    response = await send_message(owner, await general_of(owner), "well under the ceiling")
    assert response.status in (200, 201), response.body
