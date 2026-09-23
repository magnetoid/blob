"""The Calls pages in /admin: a workspace's settings, and the server's media server."""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

import pytest
import pytest_asyncio
from livekit import api

from blob_api.config import settings
from blob_api.realtime import hub

from .fake_livekit import FakeRooms
from .helpers import Client, invite_and_sign_up, sign_up

KEY = "APIexamplekey"
SECRET = "an-example-secret-long-enough-to-sign-a-jwt-with"


def configure(monkeypatch: pytest.MonkeyPatch, *, present: bool) -> None:
    monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://livekit.example.com" if present else None)
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", KEY if present else None)
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", SECRET if present else None)


@pytest_asyncio.fixture
async def people(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")  # founds the server: instance admin
    admin = await invite_and_sign_up(owner, "Admin")
    await owner.put(f"/api/admin/users/{admin.user_id}/role", {"role": "admin"})
    member = await invite_and_sign_up(owner, "Member")
    return {"owner": owner, "admin": admin, "member": member, "anonymous": client}


async def test_the_defaults_are_what_an_admin_reads(people: dict[str, Any]) -> None:
    read = await people["admin"].get("/api/admin/calls")
    assert read.status == 200, read.body
    assert read.body == {
        "huddles": {"enabled": True, "cameras": True, "screenShare": True, "maxParticipants": 50},
        "meetups": {"enabled": True, "camerasOnJoin": True, "maxParticipants": 50},
    }


async def test_a_member_may_not_read_or_change_them(people: dict[str, Any]) -> None:
    assert (await people["member"].get("/api/admin/calls")).status == 403
    assert (await people["member"].put("/api/admin/calls", {})).status == 403


async def test_a_change_is_kept_announced_and_leaves_other_settings_alone(
    people: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(hub, "to_workspace", lambda ws, event: sent.append((ws, event)))
    await people["admin"].patch("/api/admin/settings", {"settings": {"retentionDays": 90}})

    saved = await people["admin"].put(
        "/api/admin/calls",
        {"huddles": {"cameras": False, "maxParticipants": 12}, "meetups": {"camerasOnJoin": False}},
    )
    assert saved.status == 200, saved.body
    assert saved.body["huddles"]["cameras"] is False
    assert saved.body["huddles"]["maxParticipants"] == 12
    assert saved.body["meetups"]["camerasOnJoin"] is False

    assert (await people["admin"].get("/api/admin/calls")).body == saved.body
    general = (await people["admin"].get("/api/admin/settings")).body
    assert general["settings"]["retentionDays"] == 90
    # Only this change's frame is asserted: the general settings PATCH above may send
    # frames of its own, and they are not this test's business.
    announced = [event for _, event in sent if event["t"] == "calls.settings"]
    assert announced == [{"t": "calls.settings", "settings": saved.body}]


async def test_a_cap_out_of_range_is_invalid_input(people: dict[str, Any]) -> None:
    refused = await people["admin"].put(
        "/api/admin/calls", {"huddles": {"maxParticipants": 1}, "meetups": {}}
    )
    assert refused.status == 400, refused.body
    assert refused.body["error"]["code"] == "invalid_input"


async def test_the_server_panel_is_the_instance_admins(
    people: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    configure(monkeypatch, present=True)
    assert (await people["admin"].get("/api/admin/calls/server")).status == 403
    assert (await people["owner"].get("/api/admin/calls/server")).status == 200


async def test_the_server_panel_says_what_it_can_see(
    people: dict[str, Any], monkeypatch: pytest.MonkeyPatch, fake_livekit: FakeRooms
) -> None:
    configure(monkeypatch, present=False)
    bare = (await people["owner"].get("/api/admin/calls/server")).body
    assert bare["configured"] is False
    assert bare["webhookUrl"].endswith("/api/calls/livekit")

    configure(monkeypatch, present=True)
    fake_livekit.rooms["a-room"] = 10
    up = (await people["owner"].get("/api/admin/calls/server")).body
    assert up["configured"] is True
    assert up["reachable"] is True
    assert up["openRooms"] == 1
    assert up["url"] == "wss://livekit.example.com"
    assert up["lastEventAt"] is None

    body = json.dumps({"event": "room_started", "room": {"name": "a-room"}})
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    await people["anonymous"].post_raw(
        "/api/calls/livekit",
        body,
        {"authorization": api.AccessToken(KEY, SECRET).with_sha256(digest).to_jwt()},
    )
    assert (await people["owner"].get("/api/admin/calls/server")).body["lastEventAt"]

    fake_livekit.down = True
    down = (await people["owner"].get("/api/admin/calls/server")).body
    assert down["reachable"] is False
    assert down["error"]
