"""Leaving a message unread on purpose.

Its own route rather than a flag on `/read`, and the reason is the reason `/read` is
written the way it is: that one ratchets with `GREATEST(...)` so the cursor only ever
moves forward. Two tabs both mark read on focus, and a stale one arriving second must not
un-read what the other just read. Rewinding has to be something a person asked for, which
is why passing an earlier id to `/read` is — correctly — a silent no-op.

The two behaviours worth pinning are where the cursor lands, and that the mention badge
comes back. `mark_read` zeroes the badge, so a rewind that left it at zero would show a
channel as unread without saying it wanted you specifically.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "general": general}


async def say(team: dict, body: str) -> str:
    sent = await send_message(team["owner"], team["general"]["id"], body)
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def read_state(client: Client, channel_id: str) -> dict:
    states = (await client.get("/api/read-states")).body["readStates"]
    return next((s for s in states if s["channelId"] == channel_id), {})


class TestWhereTheCursorLands:
    async def test_the_marked_message_becomes_the_first_unread(self, team: dict) -> None:
        ids = [await say(team, f"m{i}") for i in range(4)]
        channel_id = team["general"]["id"]
        member = team["member"]
        read = await member.post(
            f"/api/channels/{channel_id}/read", {"lastReadMessageId": ids[3]}
        )
        assert read.status == 200, read.body

        response = await member.post(
            f"/api/channels/{channel_id}/unread", {"messageId": ids[2]}
        )
        assert response.status == 200, response.body
        # The one *before* it: marking a message unread means coming back to that
        # message, so it has to be the first thing you have not read.
        assert response.body["readState"]["lastReadMessageId"] == ids[1]

    async def test_marking_the_very_first_message_clears_the_cursor(self, team: dict) -> None:
        ids = [await say(team, f"m{i}") for i in range(2)]
        channel_id = team["general"]["id"]
        member = team["member"]
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": ids[1]})

        response = await member.post(
            f"/api/channels/{channel_id}/unread", {"messageId": ids[0]}
        )
        assert response.body["readState"]["lastReadMessageId"] is None

    async def test_it_survives_a_reload(self, team: dict) -> None:
        ids = [await say(team, f"m{i}") for i in range(3)]
        channel_id = team["general"]["id"]
        member = team["member"]
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": ids[2]})
        await member.post(f"/api/channels/{channel_id}/unread", {"messageId": ids[1]})

        assert (await read_state(member, channel_id))["lastReadMessageId"] == ids[0]

    async def test_a_message_from_another_channel_is_refused(self, team: dict) -> None:
        elsewhere = (
            await team["owner"].post("/api/channels", {"name": "other", "kind": "public"})
        ).body["channel"]
        stray = str(
            (await send_message(team["owner"], elsewhere["id"], "hi")).body["message"]["id"]
        )

        response = await team["member"].post(
            f"/api/channels/{team['general']['id']}/unread", {"messageId": stray}
        )
        assert response.status == 404


class TestTheRatchetIsStillARatchet:
    async def test_marking_read_backwards_is_still_a_no_op(self, team: dict) -> None:
        ids = [await say(team, f"m{i}") for i in range(3)]
        channel_id = team["general"]["id"]
        member = team["member"]
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": ids[2]})

        # The protection this whole separate route exists to preserve: a stale tab
        # calling /read with an older cursor must not un-read anything.
        response = await member.post(
            f"/api/channels/{channel_id}/read", {"lastReadMessageId": ids[0]}
        )
        assert response.body["readState"]["lastReadMessageId"] == ids[2]


class TestTheBadgeComesBack:
    async def test_a_mention_left_unread_counts_again(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        member = team["member"]
        await say(team, "nothing to see")
        mention = await say(team, "@Member could you look?")
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": mention})
        assert (await read_state(member, channel_id))["mentionCount"] == 0

        response = await member.post(
            f"/api/channels/{channel_id}/unread", {"messageId": mention}
        )
        # Recomputed rather than left at zero: `mark_read` zeroes it, so a rewind past a
        # message that named you would otherwise show unread without saying it wanted you.
        assert response.body["readState"]["mentionCount"] == 1

    async def test_your_own_message_never_counts(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        owner = team["owner"]
        first = await say(team, "one")
        mine = await say(team, "@Owner talking to myself")
        await owner.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": mine})

        response = await owner.post(f"/api/channels/{channel_id}/unread", {"messageId": mine})
        assert response.body["readState"]["mentionCount"] == 0
        assert response.body["readState"]["lastReadMessageId"] == first

    async def test_a_group_mention_counts_too(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        owner, member = team["owner"], team["member"]
        group = await owner.post(
            "/api/admin/groups", {"handle": "platform-team", "name": "Platform"}
        )
        assert group.status == 201, group.body
        group_id = group.body["group"]["id"]
        assert (
            await owner.put(f"/api/admin/groups/{group_id}/members/{member.user_id}")
        ).status == 200

        await say(team, "warm up")
        mention = await say(team, "@platform-team standup")
        await member.post(f"/api/channels/{channel_id}/read", {"lastReadMessageId": mention})

        response = await member.post(
            f"/api/channels/{channel_id}/unread", {"messageId": mention}
        )
        # Resolved from current membership, the same way the notifier resolves it — the
        # message stores the group, not its members.
        assert response.body["readState"]["mentionCount"] == 1
