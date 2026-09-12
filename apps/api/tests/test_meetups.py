"""Meetups: a LiveKit room attached to a channel.

These pin the things the first version got wrong and nothing tested. The client called
`/api/meetups` and the router answered at `/meetups`, so every call 404ed. Anyone could
attach a meetup to a private channel they were not in, and anyone could mint a join
token for any meetup in the workspace — a private channel's call was open to the whole
workspace the moment LiveKit was configured. An owner could not end a meetup a member
started. And with no LiveKit configured, dev handed back a fake token instead of the
`livekit_not_configured` the README and .env.example promise.

The rule under all of it is the one every other router already follows: a meetup lives
in a channel, so it inherits that channel's access — and a private channel answers 404,
not 403, to somebody outside it.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from blob_api.config import settings

from .helpers import Client, invite_and_sign_up, sign_up

LIVEKIT = {
    "LIVEKIT_URL": "wss://livekit.example.com",
    "LIVEKIT_API_KEY": "APIexamplekey",
    "LIVEKIT_API_SECRET": "an-example-secret-long-enough-to-sign-a-jwt-with",
}


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    private = (await member.post("/api/channels", {"name": "war-room", "kind": "private"})).body[
        "channel"
    ]
    return {"owner": owner, "member": member, "outsider": outsider, "private": private}


def _configure_livekit(monkeypatch: pytest.MonkeyPatch, *, present: bool) -> None:
    for name, value in LIVEKIT.items():
        monkeypatch.setattr(settings, name, value if present else None)


async def test_meetups_are_served_under_api(team: dict) -> None:
    """The client dials /api/meetups; the server has to be there."""
    response = await team["member"].post("/api/meetups", {"name": "standup"})
    assert response.status == 200, response.body
    assert response.body["status"] == "active"


async def test_a_meetup_in_a_private_channel_needs_membership(team: dict) -> None:
    """A private channel's existence is private, so an outsider gets 404, not 403."""
    private_id = team["private"]["id"]

    refused = await team["outsider"].post(
        "/api/meetups", {"name": "standup", "channelId": private_id}
    )
    assert refused.status == 404, refused.body

    allowed = await team["member"].post(
        "/api/meetups", {"name": "standup", "channelId": private_id}
    )
    assert allowed.status == 200, allowed.body
    assert allowed.body["channelId"] == private_id


async def test_joining_needs_membership_of_the_channel(
    team: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A token is a key to the room; only the channel's members may hold one."""
    _configure_livekit(monkeypatch, present=True)
    meetup = (
        await team["member"].post(
            "/api/meetups", {"name": "standup", "channelId": team["private"]["id"]}
        )
    ).body

    refused = await team["outsider"].post(f"/api/meetups/{meetup['id']}/token")
    assert refused.status == 404, refused.body

    allowed = await team["member"].post(f"/api/meetups/{meetup['id']}/token")
    assert allowed.status == 200, allowed.body
    assert allowed.body["url"] == LIVEKIT["LIVEKIT_URL"]
    assert allowed.body["token"]


async def test_an_owner_may_end_a_meetup_they_did_not_start(team: dict) -> None:
    """Admins and owners are both admins everywhere else; here too."""
    meetup = (await team["member"].post("/api/meetups", {"name": "standup"})).body

    ended = await team["owner"].post(f"/api/meetups/{meetup['id']}/end")
    assert ended.status == 200, ended.body
    assert ended.body["status"] == "ended"
    assert ended.body["endedAt"]


async def test_a_bystander_may_not_end_it(team: dict) -> None:
    meetup = (await team["member"].post("/api/meetups", {"name": "standup"})).body

    refused = await team["outsider"].post(f"/api/meetups/{meetup['id']}/end")
    assert refused.status == 403, refused.body


async def test_unconfigured_livekit_says_so_in_every_environment(
    team: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The promise in .env.example: no LiveKit means `livekit_not_configured`, not a
    fake token that fails at connect time. Tests run outside production, which is
    exactly the environment that used to get the fake."""
    _configure_livekit(monkeypatch, present=False)
    meetup = (await team["member"].post("/api/meetups", {"name": "standup"})).body

    response = await team["member"].post(f"/api/meetups/{meetup['id']}/token")
    assert response.status == 400, response.body
    assert response.body["error"]["code"] == "livekit_not_configured"
