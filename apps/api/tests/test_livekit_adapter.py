"""The one module that talks to LiveKit.

What it signs has to be exactly what the settings allow — the camera and screen settings
are only real if they are in the token — and what it accepts has to be exactly what
LiveKit signed, because the webhook route is public.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import timedelta

import pytest
from livekit import api

from blob_api.config import settings
from blob_api.lib import livekit

KEY = "APIexamplekey"
SECRET = "an-example-secret-long-enough-to-sign-a-jwt-with"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://livekit.example.com")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", KEY)
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", SECRET)


def _signed(body: str, secret: str = SECRET) -> str:
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    return api.AccessToken(KEY, secret).with_sha256(digest).to_jwt()


def test_configured_needs_all_three(monkeypatch: pytest.MonkeyPatch, configured: None) -> None:
    assert livekit.configured()
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", None)
    assert not livekit.configured()


def test_the_api_url_defaults_to_where_browsers_go(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    assert livekit.api_url() == "wss://livekit.example.com"
    monkeypatch.setattr(settings, "LIVEKIT_API_URL", "http://livekit:7880")
    assert livekit.api_url() == "http://livekit:7880"


def test_a_token_carries_exactly_the_sources_it_was_given(configured: None) -> None:
    jwt = livekit.token("user-1", "Ana", "room-1", [livekit.MICROPHONE, livekit.SCREEN_SHARE])
    claims = api.TokenVerifier(KEY, SECRET).verify(jwt)

    assert claims.identity == "user-1"
    assert claims.name == "Ana"
    assert claims.video is not None
    assert claims.video.room == "room-1"
    assert claims.video.room_join is True
    assert claims.video.can_publish_sources == ["microphone", "screen_share"]
    # Blob is the chat; LiveKit's data channel would be a second one nothing keeps.
    assert claims.video.can_publish_data is False


def test_a_token_is_short_lived(configured: None) -> None:
    assert livekit.TOKEN_TTL == timedelta(minutes=10)


def test_a_webhook_signed_with_our_key_is_accepted(configured: None) -> None:
    body = json.dumps({"event": "room_finished", "room": {"name": "room-1"}})
    event = livekit.receive(body, _signed(body))
    assert event.event == "room_finished"
    assert event.room.name == "room-1"


def test_a_bearer_prefix_is_tolerated(configured: None) -> None:
    body = json.dumps({"event": "room_started", "room": {"name": "room-1"}})
    assert livekit.receive(body, f"Bearer {_signed(body)}").event == "room_started"


def test_a_changed_body_is_refused(configured: None) -> None:
    body = json.dumps({"event": "room_finished", "room": {"name": "room-1"}})
    forged = body.replace("room-1", "room-2")
    with pytest.raises(livekit.BadSignature):
        livekit.receive(forged, _signed(body))


def test_another_secret_is_refused(configured: None) -> None:
    body = json.dumps({"event": "room_finished", "room": {"name": "room-1"}})
    with pytest.raises(livekit.BadSignature):
        livekit.receive(body, _signed(body, secret="some-other-secret-that-is-long-enough"))


def test_nothing_is_accepted_without_a_configured_livekit() -> None:
    body = json.dumps({"event": "room_finished", "room": {"name": "room-1"}})
    with pytest.raises(livekit.BadSignature):
        livekit.receive(body, "anything")


async def test_an_empty_url_is_unavailable_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    """`api.LiveKitAPI` raises `ValueError` on an empty url. Every caller in this codebase
    checks `configured()` first, so this is unreachable through `services.calls` — but the
    adapter's own contract is that nothing LiveKit-shaped escapes as anything but
    `Unavailable`, and `_FAILURES` omitting `ValueError` broke exactly that promise."""
    monkeypatch.delenv("LIVEKIT_URL", raising=False)
    monkeypatch.setattr(settings, "LIVEKIT_URL", "")
    monkeypatch.setattr(settings, "LIVEKIT_API_URL", None)
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "k")
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", "s")

    with pytest.raises(livekit.Unavailable):
        await livekit._LiveKitRooms().names()
