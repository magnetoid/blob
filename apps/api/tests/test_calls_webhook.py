"""What LiveKit tells us, and what the sweep finds out for itself.

The webhook route is public — LiveKit has no session — so the only thing that makes an
event real is a JWT over the body's hash, signed with our key. Everything it says is then
about a room we may or may not know: an unknown room, a finished call, a "left" for a
connection that has since been replaced, are all no-ops, never errors LiveKit would retry.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

import pytest
import pytest_asyncio
from livekit import api
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import livekit as livekit_module
from blob_api.lib.ids import new_id
from blob_api.lib.livekit import Participant
from blob_api.lib.redis import redis
from blob_api.services.calls import SWEEP_LEASE_KEY, reconcile

from .fake_livekit import FakeRooms
from .helpers import Client, invite_and_sign_up, sign_up

KEY = "APIexamplekey"
SECRET = "an-example-secret-long-enough-to-sign-a-jwt-with"


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://livekit.example.com")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", KEY)
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", SECRET)


@pytest_asyncio.fixture
async def live(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    group = (await member.post("/api/dms", {"userIds": [owner.user_id]})).body["channel"]
    call = (await member.post("/api/calls", {"channelId": group["id"], "kind": "huddle"})).body
    return {"owner": owner, "member": member, "call": call, "anonymous": client}


@pytest_asyncio.fixture
async def in_channel(client: Client) -> dict[str, Any]:
    """A live call in a private channel a member can leave — unlike `live`'s DM, whose
    membership is fixed, so R40's "removed from a private channel" case needs this one."""
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channel = (await owner.post("/api/channels", {"name": "war-room", "kind": "private"})).body[
        "channel"
    ]
    await owner.post(f"/api/channels/{channel['id']}/members", {"userIds": [member.user_id]})
    call = (await owner.post("/api/calls", {"channelId": channel["id"], "kind": "huddle"})).body
    return {"owner": owner, "member": member, "channel": channel, "call": call, "anonymous": client}


async def post_event(client: Client, event: dict[str, Any], secret: str = SECRET) -> Any:
    body = json.dumps(event)
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    jwt = api.AccessToken(KEY, secret).with_sha256(digest).to_jwt()
    return await client.post_raw(
        "/api/calls/livekit",
        body,
        {"authorization": jwt, "content-type": "application/webhook+json"},
    )


def joined(call_id: str, user_id: str, sid: str) -> dict[str, Any]:
    return {
        "event": "participant_joined",
        "room": {"name": call_id},
        "participant": {"identity": user_id, "sid": sid},
    }


def left(call_id: str, user_id: str, sid: str) -> dict[str, Any]:
    return {
        "event": "participant_left",
        "room": {"name": call_id},
        "participant": {"identity": user_id, "sid": sid},
    }


async def people(who: Client) -> list[str]:
    calls = (await who.get("/api/calls")).body["calls"]
    return calls[0]["participantIds"] if calls else []


async def test_a_join_and_a_leave_move_the_list(live: dict[str, Any]) -> None:
    call, member = live["call"], live["member"]
    assert (
        await post_event(live["anonymous"], joined(call["id"], member.user_id, "PA_1"))
    ).status == 200
    assert await people(member) == [member.user_id]
    assert (
        await post_event(live["anonymous"], left(call["id"], member.user_id, "PA_1"))
    ).status == 200
    assert await people(member) == []


async def test_a_stale_leave_does_not_remove_a_rejoin(live: dict[str, Any]) -> None:
    call, member, anon = live["call"], live["member"], live["anonymous"]
    await post_event(anon, joined(call["id"], member.user_id, "PA_old"))
    await post_event(anon, joined(call["id"], member.user_id, "PA_new"))
    await post_event(anon, left(call["id"], member.user_id, "PA_old"))
    assert await people(member) == [member.user_id]


async def test_a_finished_room_ends_the_call(live: dict[str, Any]) -> None:
    call, member, anon = live["call"], live["member"], live["anonymous"]
    await post_event(anon, joined(call["id"], member.user_id, "PA_1"))
    finished = await post_event(anon, {"event": "room_finished", "room": {"name": call["id"]}})
    assert finished.status == 200
    assert (await member.get("/api/calls")).body["calls"] == []
    async with SessionFactory() as session:
        count = (
            await session.execute(
                text("SELECT count(*) FROM call_participants WHERE call_id = :id"),
                {"id": call["id"]},
            )
        ).scalar_one()
    assert count == 0


async def test_a_bad_signature_is_refused(live: dict[str, Any]) -> None:
    call = live["call"]
    refused = await post_event(
        live["anonymous"],
        {"event": "room_finished", "room": {"name": call["id"]}},
        secret="not-our-secret-but-long-enough-to-sign-with",
    )
    assert refused.status == 401, refused.body
    assert len((await live["member"].get("/api/calls")).body["calls"]) == 1


async def test_rooms_that_are_not_ours_are_ignored(live: dict[str, Any]) -> None:
    anon = live["anonymous"]
    assert (
        await post_event(anon, {"event": "room_finished", "room": {"name": new_id()}})
    ).status == 200
    assert (
        await post_event(anon, {"event": "room_finished", "room": {"name": "lobby"}})
    ).status == 200
    assert (
        await post_event(anon, {"event": "track_published", "room": {"name": live["call"]["id"]}})
    ).status == 200
    assert len((await live["member"].get("/api/calls")).body["calls"]) == 1


async def _age(call_id: str, seconds: int) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE calls SET created_at = now() - make_interval(secs => :s) WHERE id = :id"),
            {"s": seconds, "id": call_id},
        )


async def test_the_sweep_ends_a_call_whose_room_is_gone(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call = live["call"]
    fake_livekit.rooms.pop(call["id"])
    assert await reconcile() == 0  # too young: its starter may still be connecting
    await _age(call["id"], 600)
    assert await reconcile() == 1
    assert (await live["member"].get("/api/calls")).body["calls"] == []


async def test_the_sweep_does_not_churn_forever_on_an_identity_with_no_user(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    """A well-formed uuid that names nobody real must not make the sweep report a change
    — and re-broadcast `call.updated` — every tick for the life of the call. `wanted` used
    to keep any uuid-shaped identity regardless of whether it resolved, while the insert
    that would have persisted it matched zero rows, so the comparison never converged."""
    call = live["call"]
    ghost = new_id()  # shaped like a real identity; no `users` row behind it
    fake_livekit.people[call["id"]] = [Participant(identity=ghost, sid="PA_ghost")]

    assert await reconcile() == 0
    assert await reconcile() == 0  # still nothing to report — not "still different"


async def test_the_sweep_replaces_who_is_in_a_call(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call, member, owner = live["call"], live["member"], live["owner"]
    await post_event(live["anonymous"], joined(call["id"], member.user_id, "PA_1"))
    fake_livekit.people[call["id"]] = [Participant(identity=owner.user_id, sid="PA_2")]
    assert await reconcile() == 1
    assert await people(member) == [owner.user_id]
    assert await reconcile() == 0  # nothing changed the second time


async def test_the_sweep_closes_a_room_left_behind_by_an_ended_call(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call = live["call"]
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE calls SET status = 'ended', ended_at = now() WHERE id = :id"),
            {"id": call["id"]},
        )
    await reconcile()
    assert call["id"] in fake_livekit.closed


# --- R39: one sweep at a time, with a budget ------------------------------------------


async def test_a_concurrent_sweep_does_nothing_while_the_first_holds_the_lease(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call = live["call"]
    fake_livekit.rooms.pop(call["id"])
    await _age(call["id"], 600)  # past the grace period: an unheld sweep would end it

    assert await redis.set(SWEEP_LEASE_KEY, "1", nx=True, ex=300)
    assert await reconcile() == 0
    assert len((await live["member"].get("/api/calls")).body["calls"]) == 1  # untouched

    await redis.delete(SWEEP_LEASE_KEY)
    assert await reconcile() == 1
    assert (await live["member"].get("/api/calls")).body["calls"] == []


async def test_the_lease_is_released_when_the_sweep_raises(
    live: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_names = fake_livekit.names

    async def boom(*_args: Any, **_kwargs: Any) -> set[str]:
        raise RuntimeError("boom")

    monkeypatch.setattr(fake_livekit, "names", boom)
    with pytest.raises(RuntimeError):
        await reconcile()
    assert not await redis.exists(SWEEP_LEASE_KEY)

    # The lease being gone is not just a fact about Redis: a fresh sweep can proceed.
    monkeypatch.setattr(fake_livekit, "names", real_names)
    assert await reconcile() == 0


# --- R40: somebody who loses access is removed from the call --------------------------


async def test_a_member_who_leaves_the_channel_is_removed_from_a_live_call(
    in_channel: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call, member = in_channel["call"], in_channel["member"]
    channel, owner, anon = in_channel["channel"], in_channel["owner"], in_channel["anonymous"]
    await post_event(anon, joined(call["id"], member.user_id, "PA_1"))
    fake_livekit.people[call["id"]] = [Participant(identity=member.user_id, sid="PA_1")]
    assert await people(owner) == [member.user_id]

    left = await member.post(f"/api/channels/{channel['id']}/leave")
    assert left.status == 200, left.body

    assert await reconcile() == 1
    assert await people(owner) == []
    assert (call["id"], member.user_id) in fake_livekit.removed


async def test_a_deactivated_member_is_removed_from_a_live_call(
    in_channel: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call, member, owner = in_channel["call"], in_channel["member"], in_channel["owner"]
    anon = in_channel["anonymous"]
    await post_event(anon, joined(call["id"], member.user_id, "PA_1"))
    fake_livekit.people[call["id"]] = [Participant(identity=member.user_id, sid="PA_1")]
    assert await people(owner) == [member.user_id]

    deactivated = await owner.post(f"/api/admin/users/{member.user_id}/deactivate")
    assert deactivated.status == 200, deactivated.body

    assert await reconcile() == 1
    assert await people(owner) == []
    assert (call["id"], member.user_id) in fake_livekit.removed


async def test_an_active_member_is_never_removed(
    live: dict[str, Any], fake_livekit: FakeRooms
) -> None:
    call, member = live["call"], live["member"]
    await post_event(live["anonymous"], joined(call["id"], member.user_id, "PA_1"))
    fake_livekit.people[call["id"]] = [Participant(identity=member.user_id, sid="PA_1")]

    assert await reconcile() == 0  # already matches; nothing to change
    assert fake_livekit.removed == []
    assert await people(member) == [member.user_id]


async def test_a_membership_check_that_raises_leaves_the_participant_alone(
    live: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A query that cannot answer must not be read as "no access": that would eject
    somebody entitled to be in the call on nothing but a transient error."""
    call, member = live["call"], live["member"]
    await post_event(live["anonymous"], joined(call["id"], member.user_id, "PA_1"))
    fake_livekit.people[call["id"]] = [Participant(identity=member.user_id, sid="PA_1")]

    real_execute = AsyncSession.execute

    async def flaky_execute(self: AsyncSession, statement: Any, *args: Any, **kwargs: Any) -> Any:
        # Narrow to `_still_allowed`'s own query — `state_for`'s unrelated
        # `channel_members` join runs on every `GET /api/calls` this test makes below,
        # and must not be caught by the same net.
        if "JOIN users u ON u.id = cm.user_id" in str(statement):
            raise RuntimeError("db hiccup")
        return await real_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "execute", flaky_execute)

    assert await reconcile() == 0
    assert fake_livekit.removed == []
    assert await people(member) == [member.user_id]


# --- R41: a webhook body with no ceiling -----------------------------------------------


async def test_an_oversized_body_is_refused_before_the_signature_is_checked(
    live: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("the signature must not be checked on an oversized body")

    monkeypatch.setattr(livekit_module, "receive", boom)
    huge = "x" * (64 * 1024 + 1)
    refused = await live["anonymous"].post_raw("/api/calls/livekit", huge, {"authorization": "w"})
    assert refused.status == 401, refused.body
    assert refused.body["error"]["code"] == "unauthorized"
    # Untouched — the call this fixture already started is still exactly as it was.
    assert len((await live["member"].get("/api/calls")).body["calls"]) == 1


async def test_a_body_at_the_ceiling_is_still_checked_normally(live: dict[str, Any]) -> None:
    """The limit is on the body LiveKit sends, not a trap for an ordinary one — padding an
    otherwise-valid event up to just under 64 KB must still be verified and applied."""
    call = live["call"]
    event = {
        "event": "participant_joined",
        "room": {"name": call["id"]},
        "participant": {"identity": live["member"].user_id, "sid": "PA_1"},
        "padding": "x" * (60 * 1024),
    }
    assert len(json.dumps(event)) < 64 * 1024
    accepted = await post_event(live["anonymous"], event)
    assert accepted.status == 200, accepted.body
    assert await people(live["member"]) == [live["member"].user_id]
