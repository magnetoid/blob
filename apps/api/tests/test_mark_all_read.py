"""Slack's Shift+Esc: everything, everywhere, read.

One statement rather than a loop over channels, because the set of channels is exactly
the set of memberships and the person most likely to press this is the one with the most
of them. What is worth pinning is that it reaches every channel rather than the open one,
that it clears mention badges as well as cursors, that it obeys the same forward-only
ratchet `/read` does, and that it cannot see a channel the person is not in.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    return {"owner": owner, "member": member, "channels": channels}


async def say(owner: Client, channel_id: str, body: str) -> str:
    sent = await send_message(owner, channel_id, body)
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def states(client: Client) -> dict:
    body = (await client.get("/api/read-states")).body
    return {s["channelId"]: s for s in body["readStates"]}


class TestMarkingEverythingRead:
    async def test_every_channel_the_person_is_in_goes_quiet(self, team: dict) -> None:
        member, owner = team["member"], team["owner"]
        newest = {}
        for channel in team["channels"]:
            newest[channel["id"]] = await say(owner, channel["id"], "unread thing")

        answer = await member.post("/api/read-states/all", {})

        assert answer.status == 200, answer.body
        after = await states(member)
        for channel_id, last in newest.items():
            assert after[channel_id]["lastReadMessageId"] == last, channel_id

    async def test_the_mention_badge_clears_too(self, team: dict) -> None:
        # A cursor at the end with a badge still showing is a channel that claims to be
        # read and still shouts. The badge is raised through /unread, which recomputes
        # it from the messages past the cursor — the send path leaves that to the
        # worker, so this is how a test gets a real one.
        member, owner = team["member"], team["owner"]
        general = next(c for c in team["channels"] if c["name"] == "general")
        channel_id = general["id"]
        mention = await say(owner, channel_id, "@Member could you look?")
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": mention})
        rewound = await member.post(f"/api/channels/{channel_id}/unread", {"messageId": mention})
        assert rewound.body["readState"]["mentionCount"] == 1

        await member.post("/api/read-states/all", {})

        after = (await member.get("/api/read-states")).body
        assert after["totalMentions"] == 0

    async def test_running_it_twice_changes_nothing(self, team: dict) -> None:
        member, owner = team["member"], team["owner"]
        channel_id = team["channels"][0]["id"]
        last = await say(owner, channel_id, "one")

        await member.post("/api/read-states/all", {})
        first = await states(member)
        second_call = await member.post("/api/read-states/all", {})

        assert second_call.status == 200
        # Nothing moved, so nothing is worth broadcasting.
        assert second_call.body["readStates"] == []
        assert first[channel_id]["lastReadMessageId"] == last

    async def test_it_does_not_rewind_a_cursor(self, team: dict) -> None:
        # The ratchet `/read` relies on: a message arriving after the sweep must stay
        # unread rather than being swallowed by a stale cursor.
        member, owner = team["member"], team["owner"]
        channel_id = team["channels"][0]["id"]
        await say(owner, channel_id, "before")
        await member.post("/api/read-states/all", {})
        later = await say(owner, channel_id, "after")

        after = await states(member)

        assert after[channel_id]["lastReadMessageId"] != later

    async def test_it_cannot_reach_a_channel_the_person_is_not_in(self, team: dict) -> None:
        member, owner = team["member"], team["owner"]
        private = await owner.post("/api/channels", {"name": "owners-only", "kind": "private"})
        assert private.status == 200, private.body
        private_id = private.body["channel"]["id"]
        await say(owner, private_id, "not for you")

        await member.post("/api/read-states/all", {})

        assert private_id not in await states(member)
