"""Calls: a huddle or a meetup, which is a LiveKit room belonging to one conversation.

The rules that carry over from meetups (tests/test_meetups.py, now retired): a call
inherits its conversation's access, so an outsider gets the 404 the channel gives them;
only the starter or an admin ends one; and no LiveKit is a supported state that says so.
The new ones: starting a call that is live joins it, a kind that is switched off cannot
be started or joined, and the camera and screen settings are in the token itself.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from livekit import api
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.realtime import hub

from .fake_livekit import FakeRooms
from .helpers import Client, invite_and_sign_up, sign_up

KEY = "APIexamplekey"
SECRET = "an-example-secret-long-enough-to-sign-a-jwt-with"
LIVEKIT = {
    "LIVEKIT_URL": "wss://livekit.example.com",
    "LIVEKIT_API_KEY": KEY,
    "LIVEKIT_API_SECRET": SECRET,
}


def configure(monkeypatch: pytest.MonkeyPatch, *, present: bool) -> None:
    for name, value in LIVEKIT.items():
        monkeypatch.setattr(settings, name, value if present else None)


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    configure(monkeypatch, present=True)


@pytest.fixture
def frames(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Every frame sent to a channel, in order."""
    sent: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(
        hub, "to_channel", lambda channel_id, event: sent.append((channel_id, event))
    )
    return sent


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    bystander = await invite_and_sign_up(owner, "Bystander")
    outsider = await invite_and_sign_up(owner, "Outsider")
    private = (await member.post("/api/channels", {"name": "war-room", "kind": "private"})).body[
        "channel"
    ]
    group = (await member.post("/api/dms", {"userIds": [owner.user_id, bystander.user_id]})).body[
        "channel"
    ]
    return {
        "owner": owner,
        "member": member,
        "bystander": bystander,
        "outsider": outsider,
        "private": private,
        "group": group,
    }


async def start(who: Client, channel: dict[str, Any], kind: str = "meetup") -> Any:
    return await who.post("/api/calls", {"channelId": channel["id"], "kind": kind})


async def test_a_start_creates_the_room_with_the_kinds_cap(
    team: dict[str, Any], fake_livekit: FakeRooms, frames: list
) -> None:
    started = await start(team["member"], team["private"])
    assert started.status == 200, started.body
    call = started.body
    assert call["kind"] == "meetup"
    assert call["status"] == "active"
    assert call["participantIds"] == []
    assert fake_livekit.rooms == {call["id"]: 50}
    assert frames == [(team["private"]["id"], {"t": "call.started", "call": call})]


async def test_starting_a_live_call_joins_it(
    team: dict[str, Any], fake_livekit: FakeRooms, frames: list
) -> None:
    first = await start(team["member"], team["group"])
    second = await start(team["owner"], team["group"])
    assert second.status == 200, second.body
    assert second.body["id"] == first.body["id"]
    assert len(fake_livekit.rooms) == 1
    # Joining a live call is not starting one: only the first start announces it.
    assert frames == [(team["group"]["id"], {"t": "call.started", "call": first.body})]


async def test_a_huddle_and_a_meetup_can_both_be_live(team: dict[str, Any]) -> None:
    meetup = await start(team["member"], team["group"], "meetup")
    huddle = await start(team["member"], team["group"], "huddle")
    assert huddle.status == 200, huddle.body
    assert huddle.body["id"] != meetup.body["id"]


async def test_an_outsider_gets_the_channels_404_everywhere(team: dict[str, Any]) -> None:
    call = (await start(team["member"], team["private"])).body
    outsider = team["outsider"]
    assert (await start(outsider, team["private"])).status == 404
    assert (await outsider.post(f"/api/calls/{call['id']}/token")).status == 404
    assert (await outsider.post(f"/api/calls/{call['id']}/end")).status == 404


async def test_starting_in_an_archived_channel_is_refused(team: dict[str, Any]) -> None:
    """A call is a write to its conversation, so a read-only channel refuses one — the
    same status and code `test_an_archived_channel_is_read_only` pins for a message."""
    created = await team["owner"].post("/api/channels", {"name": "temporary", "kind": "public"})
    channel = created.body["channel"]
    await team["owner"].post(f"/api/channels/{channel['id']}/archive")

    refused = await start(team["owner"], channel)
    assert refused.status == 403, refused.body
    assert refused.body["error"]["code"] == "forbidden"


async def test_the_list_holds_only_calls_in_your_conversations(team: dict[str, Any]) -> None:
    call = (await start(team["member"], team["private"])).body
    mine = (await team["member"].get("/api/calls")).body
    theirs = (await team["outsider"].get("/api/calls")).body
    assert [c["id"] for c in mine["calls"]] == [call["id"]]
    assert theirs["calls"] == []
    assert mine["available"] is True
    assert mine["settings"]["huddles"]["maxParticipants"] == 50


async def test_the_token_carries_what_the_settings_allow(team: dict[str, Any]) -> None:
    saved = await team["owner"].put(
        "/api/admin/calls",
        {"huddles": {"cameras": False}, "meetups": {}},
    )
    assert saved.status == 200, saved.body
    huddle = (await start(team["member"], team["group"], "huddle")).body
    meetup = (await start(team["member"], team["group"], "meetup")).body

    for call, expected in (
        (huddle, ["microphone", "screen_share", "screen_share_audio"]),
        (meetup, ["microphone", "camera", "screen_share", "screen_share_audio"]),
    ):
        issued = await team["member"].post(f"/api/calls/{call['id']}/token")
        assert issued.status == 200, issued.body
        assert issued.body["url"] == LIVEKIT["LIVEKIT_URL"]
        claims = api.TokenVerifier(KEY, SECRET).verify(issued.body["token"])
        assert claims.identity == team["member"].user_id
        assert claims.video is not None
        assert claims.video.room == call["id"]
        assert claims.video.can_publish_sources == expected


async def test_the_cap_is_set_on_the_room(team: dict[str, Any], fake_livekit: FakeRooms) -> None:
    saved = await team["owner"].put(
        "/api/admin/calls", {"huddles": {"maxParticipants": 7}, "meetups": {}}
    )
    assert saved.status == 200, saved.body
    call = (await start(team["member"], team["group"], "huddle")).body
    assert fake_livekit.rooms[call["id"]] == 7


async def test_a_kind_that_is_off_can_neither_start_nor_mint(team: dict[str, Any]) -> None:
    live = (await start(team["member"], team["group"], "meetup")).body
    saved = await team["owner"].put(
        "/api/admin/calls", {"huddles": {}, "meetups": {"enabled": False}}
    )
    assert saved.status == 200, saved.body

    refused = await start(team["member"], team["group"], "meetup")
    assert refused.status == 403, refused.body
    assert refused.body["error"]["code"] == "meetups_off"

    token = await team["member"].post(f"/api/calls/{live['id']}/token")
    assert token.status == 403, token.body
    assert token.body["error"]["code"] == "meetups_off"

    still_works = await start(team["member"], team["group"], "huddle")
    assert still_works.status == 200, still_works.body
    huddle = still_works.body

    # The kinds are independent: turning meetups off leaves huddles alone, and
    # turning huddles off now leaves the meetup refusal above untouched.
    saved_2 = await team["owner"].put(
        "/api/admin/calls", {"huddles": {"enabled": False}, "meetups": {}}
    )
    assert saved_2.status == 200, saved_2.body

    refused_huddle = await start(team["member"], team["group"], "huddle")
    assert refused_huddle.status == 403, refused_huddle.body
    assert refused_huddle.body["error"]["code"] == "huddles_off"

    huddle_token = await team["member"].post(f"/api/calls/{huddle['id']}/token")
    assert huddle_token.status == 403, huddle_token.body
    assert huddle_token.body["error"]["code"] == "huddles_off"


async def test_a_start_livekit_refuses_writes_nothing(
    team: dict[str, Any], fake_livekit: FakeRooms, frames: list
) -> None:
    fake_livekit.down = True
    refused = await start(team["member"], team["private"])
    assert refused.status == 503, refused.body
    assert refused.body["error"]["code"] == "calls_unavailable"
    assert (await team["member"].get("/api/calls")).body["calls"] == []
    assert frames == []


async def test_no_livekit_is_a_state_that_says_so(
    team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    configure(monkeypatch, present=False)
    state = (await team["member"].get("/api/calls")).body
    assert state["available"] is False
    refused = await start(team["member"], team["private"])
    assert refused.status == 400, refused.body
    assert refused.body["error"]["code"] == "livekit_not_configured"


async def test_a_token_with_no_livekit_says_so(
    team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A call already running loses its media server the same way a fresh one would."""
    call = (await start(team["member"], team["private"])).body
    configure(monkeypatch, present=False)
    refused = await team["member"].post(f"/api/calls/{call['id']}/token")
    assert refused.status == 400, refused.body
    assert refused.body["error"]["code"] == "livekit_not_configured"


async def test_the_starter_or_an_admin_ends_it_and_a_bystander_cannot(
    team: dict[str, Any], fake_livekit: FakeRooms, frames: list
) -> None:
    call = (await start(team["member"], team["group"])).body

    refused = await team["bystander"].post(f"/api/calls/{call['id']}/end")
    assert refused.status == 403, refused.body

    ended = await team["owner"].post(f"/api/calls/{call['id']}/end")
    assert ended.status == 200, ended.body
    assert ended.body["status"] == "ended"
    assert ended.body["endedAt"]
    assert call["id"] in fake_livekit.closed
    assert (team["group"]["id"], {"t": "call.ended", "callId": call["id"]}) in frames
    assert (await team["member"].get("/api/calls")).body["calls"] == []


async def test_ending_closes_the_room_only_after_its_own_commit(
    team: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`end` opens its own transaction and must not still be inside it while it closes
    the LiveKit room: `AfterCommit.drain()` runs synchronously and inline, so a close
    that happens first — a network call with its own 5s budget — makes COMMIT, and the
    `call.ended` broadcast queued behind it, wait on LiveKit."""
    call = (await start(team["member"], team["group"])).body
    order: list[str] = []
    monkeypatch.setattr(hub, "to_channel", lambda *_a, **_k: order.append("broadcast"))
    real_close = fake_livekit.close

    async def tracked_close(name: str) -> None:
        order.append("closed")
        await real_close(name)

    monkeypatch.setattr(fake_livekit, "close", tracked_close)

    ended = await team["member"].post(f"/api/calls/{call['id']}/end")
    assert ended.status == 200, ended.body
    assert order == ["broadcast", "closed"]


async def test_ending_with_no_livekit_still_ends_it(
    team: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Closing the room is best-effort cleanup, not a precondition: a call that Blob
    can no longer reach LiveKit for still ends, because the end itself is Blob's row."""
    call = (await start(team["member"], team["group"])).body
    configure(monkeypatch, present=False)

    ended = await team["member"].post(f"/api/calls/{call['id']}/end")
    assert ended.status == 200, ended.body
    assert ended.body["status"] == "ended"
    assert fake_livekit.closed == []


async def test_an_ended_call_mints_no_token(team: dict[str, Any]) -> None:
    call = (await start(team["member"], team["group"])).body
    await team["member"].post(f"/api/calls/{call['id']}/end")
    refused = await team["member"].post(f"/api/calls/{call['id']}/token")
    assert refused.status == 400, refused.body
    assert refused.body["error"]["code"] == "call_ended"


async def test_the_old_routes_are_gone(team: dict[str, Any]) -> None:
    assert (await team["member"].post("/api/meetups", {"name": "x"})).status == 404


async def test_more_than_30_token_requests_a_minute_are_refused(
    team: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    """Joining is more frequent than starting — a reload re-joins — so `call_token` has
    its own bucket rather than sharing `start_call`'s tighter one."""
    call = (await start(team["member"], team["private"])).body
    for _ in range(30):
        ok = await team["member"].post(f"/api/calls/{call['id']}/token")
        assert ok.status == 200, ok.body
    refused = await team["member"].post(f"/api/calls/{call['id']}/token")
    assert refused.status == 429, refused.body
    assert refused.body["error"]["code"] == "rate_limited"


async def test_a_token_still_works_when_the_room_already_exists(
    team: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    """`token` mints a fresh pass into a room `start` already created — the common case,
    since starting a call and joining it are two different requests."""
    call = (await start(team["member"], team["private"])).body
    assert call["id"] in fake_livekit.rooms
    issued = await team["member"].post(f"/api/calls/{call['id']}/token")
    assert issued.status == 200, issued.body


async def test_the_foreign_keys_are_named_for_the_table_they_are_on() -> None:
    """0045 renamed `meetups` to `calls`, but `RENAME TABLE` alone leaves a foreign key's
    name exactly where it was — Postgres never renames a constraint on your behalf, and
    `alembic check` compares foreign keys by signature rather than by name, so a stale
    `meetups_*` name stays quiet forever unless something actually looks for it."""
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT constraint_name FROM information_schema.table_constraints
                     WHERE table_name = 'calls' AND constraint_type = 'FOREIGN KEY'
                    """
                )
            )
        ).fetchall()
    names = {row.constraint_name for row in rows}
    assert names, "no foreign keys found for calls — has the schema been migrated?"
    stale = {name for name in names if name.startswith("meetups_")}
    assert not stale, f"calls still has foreign keys named for the old table: {sorted(stale)}"
