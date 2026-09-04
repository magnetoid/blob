"""Following a thread, and being told when it has moved.

Two columns on `thread_subscriptions` were dead weight from the first migration.
`muted` was never written by anything, so replying subscribed you permanently and the
only escape was muting the whole channel. `last_read_reply_id` was written — set to your
own reply every time you posted one — and read by nothing, so a thread you had read to
the end looked exactly like one with ten new replies in it.
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
    return {"owner": owner, "member": member, "general": general["id"]}


async def a_thread(team: dict) -> str:
    root = await send_message(team["owner"], team["general"], "root")
    return str(root.body["message"]["id"])


async def listed(client: Client) -> dict:
    return dict((await client.get("/api/threads")).body)


class TestFollowing:
    async def test_replying_still_follows_it(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "reply", threadRootId=root_id)

        state = await team["owner"].get(f"/api/messages/{root_id}/thread/following")

        assert state.body["following"] is True
        assert [m["id"] for m in (await listed(team["owner"]))["messages"]] == [root_id]

    async def test_you_can_stop(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "reply", threadRootId=root_id)

        off = await team["owner"].put(
            f"/api/messages/{root_id}/thread/following", {"following": False}
        )

        assert off.status == 200 and off.body["following"] is False
        # Gone from the list, and it stays gone.
        assert (await listed(team["owner"]))["messages"] == []

    async def test_and_start_again(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "reply", threadRootId=root_id)
        await team["owner"].put(f"/api/messages/{root_id}/thread/following", {"following": False})

        await team["owner"].put(f"/api/messages/{root_id}/thread/following", {"following": True})

        assert [m["id"] for m in (await listed(team["owner"]))["messages"]] == [root_id]

    async def test_you_can_follow_one_you_never_replied_in(self, team: dict) -> None:
        # Slack's "also send me replies". Until now the only way onto the list was to say
        # something, which is a poor price for wanting to listen.
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "reply", threadRootId=root_id)

        await team["member"].put(f"/api/messages/{root_id}/thread/following", {"following": True})

        assert [m["id"] for m in (await listed(team["member"]))["messages"]] == [root_id]

    async def test_following_from_scratch_starts_you_at_the_end(self, team: dict) -> None:
        # You asked to hear what happens next, not to be handed everything already said.
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "old news", threadRootId=root_id)

        await team["member"].put(f"/api/messages/{root_id}/thread/following", {"following": True})

        assert (await listed(team["member"]))["unreadRootIds"] == []

    async def test_a_thread_you_cannot_see_is_not_followable(self, team: dict) -> None:
        private = await team["owner"].post(
            "/api/channels", {"name": "hidden-room", "kind": "private"}
        )
        root = await send_message(team["owner"], private.body["channel"]["id"], "secret")

        refused = await team["member"].put(
            f"/api/messages/{root.body['message']['id']}/thread/following", {"following": True}
        )

        # 404, not 403: the existence of a private channel is the private part.
        assert refused.status == 404


class TestUnread:
    async def test_a_new_reply_shows_as_unread(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "mine", threadRootId=root_id)
        await send_message(team["member"], team["general"], "theirs", threadRootId=root_id)

        assert (await listed(team["owner"]))["unreadRootIds"] == [root_id]

    async def test_your_own_reply_is_not_unread_to_you(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "mine", threadRootId=root_id)

        assert (await listed(team["owner"]))["unreadRootIds"] == []

    async def test_reading_it_clears_the_mark(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "mine", threadRootId=root_id)
        await send_message(team["member"], team["general"], "theirs", threadRootId=root_id)

        await team["owner"].post(f"/api/messages/{root_id}/thread/read")

        assert (await listed(team["owner"]))["unreadRootIds"] == []

    async def test_and_a_later_reply_brings_it_back(self, team: dict) -> None:
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "mine", threadRootId=root_id)
        await send_message(team["member"], team["general"], "theirs", threadRootId=root_id)
        await team["owner"].post(f"/api/messages/{root_id}/thread/read")

        await send_message(team["member"], team["general"], "and another", threadRootId=root_id)

        assert (await listed(team["owner"]))["unreadRootIds"] == [root_id]

    async def test_reading_does_not_subscribe_you(self, team: dict) -> None:
        # Opening a thread to look is not asking to be told about it for ever.
        root_id = await a_thread(team)
        await send_message(team["owner"], team["general"], "reply", threadRootId=root_id)

        await team["member"].post(f"/api/messages/{root_id}/thread/read")

        assert (await listed(team["member"]))["messages"] == []
