"""Messages put aside for later.

Pinning is the channel's memory and is visible to everybody in it; this is one person's
and is visible to nobody else. That distinction is most of what these assert.

The one that matters beyond correctness is `test_leaving_a_channel_takes_its_messages`.
The list joins `channel_members` exactly the way `search` does, and for the same reason:
a row in `saved_items` is a bookmark, never a grant. Saving must not become a way to keep
reading a conversation you were removed from.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "general": general}


async def a_message(team: dict, body: str = "worth keeping") -> str:
    response = await send_message(team["owner"], team["general"]["id"], body)
    assert response.status == 201, response.body
    return str(response.body["message"]["id"])


async def saved_bodies(client: Client) -> list[str]:
    response = await client.get("/api/saved")
    assert response.status == 200, response.body
    return [m["body"] for m in response.body["messages"]]


class TestSaving:
    async def test_a_saved_message_comes_back(self, team: dict) -> None:
        message_id = await a_message(team)
        assert (
            await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
        ).status == 200
        assert await saved_bodies(team["owner"]) == ["worth keeping"]

    async def test_saving_twice_saves_once(self, team: dict) -> None:
        message_id = await a_message(team)
        for _ in range(2):
            assert (
                await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
            ).status == 200
        # The primary key is the pair, so the second insert conflicts into nothing —
        # no read-then-write for two taps on a phone to race through.
        assert await saved_bodies(team["owner"]) == ["worth keeping"]

    async def test_unsaving_removes_it_and_is_also_idempotent(self, team: dict) -> None:
        message_id = await a_message(team)
        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})

        for _ in range(2):
            assert (
                await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": False})
            ).status == 200
        assert await saved_bodies(team["owner"]) == []

    async def test_the_newest_save_is_first(self, team: dict) -> None:
        first = await a_message(team, "older")
        second = await a_message(team, "newer")

        # Saved in the opposite order to the messages, because the list is ordered by
        # when it was put aside rather than when it was written.
        await team["owner"].put(f"/api/messages/{second}/save", {"saved": True})
        await team["owner"].put(f"/api/messages/{first}/save", {"saved": True})
        assert await saved_bodies(team["owner"]) == ["older", "newer"]

    async def test_a_message_that_is_gone_cannot_be_saved(self, team: dict) -> None:
        message_id = await a_message(team)
        assert (await team["owner"].delete(f"/api/messages/{message_id}")).status == 200

        response = await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
        assert response.status == 404

    async def test_a_deleted_message_drops_out_of_the_list(self, team: dict) -> None:
        message_id = await a_message(team)
        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
        await team["owner"].delete(f"/api/messages/{message_id}")

        # Soft-deleted, so the row survives and the read has to exclude it.
        assert await saved_bodies(team["owner"]) == []


class TestItIsYours:
    async def test_saving_is_invisible_to_everybody_else(self, team: dict) -> None:
        message_id = await a_message(team)
        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})

        assert await saved_bodies(team["member"]) == []
        # And it is not pinning: the channel is told nothing.
        assert (await team["owner"].get(f"/api/channels/{team['general']['id']}/pins")).body[
            "messages"
        ] == []

    async def test_two_people_can_save_the_same_message(self, team: dict) -> None:
        message_id = await a_message(team)
        for who in ("owner", "member"):
            assert (
                await team[who].put(f"/api/messages/{message_id}/save", {"saved": True})
            ).status == 200

        assert await saved_bodies(team["owner"]) == ["worth keeping"]
        assert await saved_bodies(team["member"]) == ["worth keeping"]

    async def test_unsaving_touches_only_your_own(self, team: dict) -> None:
        message_id = await a_message(team)
        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
        await team["member"].put(f"/api/messages/{message_id}/save", {"saved": True})

        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": False})
        assert await saved_bodies(team["owner"]) == []
        assert await saved_bodies(team["member"]) == ["worth keeping"]


class TestAccess:
    async def test_a_channel_you_are_not_in_cannot_be_saved_from(self, team: dict) -> None:
        private = (
            await team["owner"].post("/api/channels", {"name": "founders", "kind": "private"})
        ).body["channel"]
        message_id = str(
            (await send_message(team["owner"], private["id"], "secret")).body["message"]["id"]
        )

        response = await team["member"].put(f"/api/messages/{message_id}/save", {"saved": True})
        # 404 rather than 403: a private channel's existence is private.
        assert response.status == 404

    async def test_leaving_a_channel_takes_its_messages(self, team: dict) -> None:
        channel = (
            await team["owner"].post("/api/channels", {"name": "planning", "kind": "public"})
        ).body["channel"]
        await team["member"].post(f"/api/channels/{channel['id']}/join")
        message_id = str(
            (await send_message(team["owner"], channel["id"], "the plan")).body["message"]["id"]
        )
        await team["member"].put(f"/api/messages/{message_id}/save", {"saved": True})
        assert await saved_bodies(team["member"]) == ["the plan"]

        assert (await team["member"].post(f"/api/channels/{channel['id']}/leave")).status == 200

        # A bookmark is not a grant. This is the same join `search` uses, and dropping it
        # would make saving a way to keep reading a room you were removed from.
        assert await saved_bodies(team["member"]) == []


class TestBootPayload:
    async def test_the_ids_ride_along_so_the_menu_can_label_itself(self, team: dict) -> None:
        message_id = await a_message(team)
        assert (await team["owner"].get("/api/bootstrap")).body["savedMessageIds"] == []

        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": True})
        # Ids only — enough to say "Remove from later" instead of "Save for later",
        # without a per-user field on every message every broadcast is built from.
        assert (await team["owner"].get("/api/bootstrap")).body["savedMessageIds"] == [message_id]

    @pytest.mark.parametrize("saved", [True, False])
    async def test_it_is_empty_for_somebody_who_saved_nothing(
        self, team: dict, saved: bool
    ) -> None:
        message_id = await a_message(team)
        await team["owner"].put(f"/api/messages/{message_id}/save", {"saved": saved})
        assert (await team["member"].get("/api/bootstrap")).body["savedMessageIds"] == []
