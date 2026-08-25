"""Fetching one message by id — what a permalink resolves against.

This was the missing verb. A message could be edited, deleted, pinned, reacted to and
read as a whole thread, but not simply fetched, so there was no way for a link to say
"this message" and have the client work out where to go.

The reply case is the reason the endpoint exists rather than the link just carrying a
channel id. `history` filters `thread_root_id IS NULL` in all three of its modes, so a
thread reply is never in channel history — the reply's own row is the only thing that
can say which thread to open.
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


class TestResolvingOne:
    async def test_it_comes_back_with_the_channel_it_is_in(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["general"]["id"], "here it is")
        message_id = sent.body["message"]["id"]

        response = await team["member"].get(f"/api/messages/{message_id}")
        assert response.status == 200, response.body
        assert response.body["message"]["body"] == "here it is"
        # The whole point: the link carries an id and nothing else, so this is what
        # tells the client which channel to open.
        assert response.body["message"]["channelId"] == team["general"]["id"]

    async def test_a_reply_names_its_thread(self, team: dict) -> None:
        root = (await send_message(team["owner"], team["general"]["id"], "root")).body["message"]
        reply = (
            await send_message(
                team["owner"], team["general"]["id"], "reply", threadRootId=root["id"]
            )
        ).body["message"]

        response = await team["member"].get(f"/api/messages/{reply['id']}")
        assert response.status == 200, response.body
        # A reply is never in channel history, so without this the client would centre
        # the channel on an id that is not in it and land nowhere.
        assert response.body["message"]["threadRootId"] == root["id"]

    async def test_a_deleted_message_is_gone(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["general"]["id"], "briefly")
        message_id = sent.body["message"]["id"]
        assert (await team["owner"].delete(f"/api/messages/{message_id}")).status == 200

        assert (await team["member"].get(f"/api/messages/{message_id}")).status == 404

    async def test_an_id_that_never_existed_is_a_404_not_a_500(self, team: dict) -> None:
        response = await team["owner"].get(
            "/api/messages/01890000-0000-7000-8000-000000000000"
        )
        assert response.status == 404


class TestAccess:
    async def test_a_link_to_a_private_channel_tells_a_stranger_nothing(
        self, team: dict
    ) -> None:
        private = (
            await team["owner"].post("/api/channels", {"name": "founders", "kind": "private"})
        ).body["channel"]
        message_id = (
            await send_message(team["owner"], private["id"], "secret")
        ).body["message"]["id"]

        response = await team["member"].get(f"/api/messages/{message_id}")
        # 404, and the same 404 a deleted message gives: pasting a link somebody was not
        # meant to have must not confirm that the message exists.
        assert response.status == 404

    async def test_a_signed_out_stranger_gets_nowhere(self, team: dict) -> None:
        message_id = (
            await send_message(team["owner"], team["general"]["id"], "public-ish")
        ).body["message"]["id"]

        response = await team["owner"].fork().get(f"/api/messages/{message_id}")
        assert response.status == 401


class TestJumpingToIt:
    async def test_history_around_a_message_returns_both_sides_of_it(
        self, team: dict
    ) -> None:
        ids = []
        for index in range(9):
            sent = await send_message(team["owner"], team["general"]["id"], f"m{index}")
            ids.append(sent.body["message"]["id"])
        target = ids[4]

        response = await team["owner"].get(
            f"/api/channels/{team['general']['id']}/messages?around={target}&limit=6"
        )
        assert response.status == 200, response.body
        returned = [m["id"] for m in response.body["messages"]]

        # A permalink to something old is the normal case, so the page has to contain
        # the target with context on both sides rather than the newest page.
        assert target in returned
        assert returned.index(target) > 0
        assert returned.index(target) < len(returned) - 1
        assert returned == sorted(returned)
