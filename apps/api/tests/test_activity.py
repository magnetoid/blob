"""Activity: mentions of you, reactions to what you wrote, and nobody else's business."""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.services import activity as activity_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    return {"owner": owner, "member": member, "outsider": outsider, "general": general}


async def feed(who: Client, query: str = "") -> list[dict[str, Any]]:
    answer = await who.get(f"/api/activity{query}")
    assert answer.status == 200, answer.body
    return list(answer.body["items"])


async def _stored(user_id: str) -> list[Any]:
    async with SessionFactory() as session:
        return list(
            (
                await session.execute(
                    sql(
                        """
                        SELECT kind, message_id, actor_id, emoji
                          FROM activity_events
                         WHERE user_id = :id
                         ORDER BY created_at, id
                        """
                    ),
                    {"id": user_id},
                )
            ).fetchall()
        )


async def _workspace_of(user_id: str) -> str:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                sql("SELECT workspace_id FROM users WHERE id = :id"),
                {"id": user_id},
            )
        ).fetchone()
    assert row is not None
    return str(row.workspace_id)


class TestWhatLandsThere:
    async def test_a_mention_of_you_lands_with_who_said_it(self, team: dict[str, Any]) -> None:
        said = await send_message(team["member"], team["general"], "@Owner can you look?")
        (item,) = await feed(team["owner"])
        assert item["kind"] == "mention"
        assert item["message"]["id"] == said.body["message"]["id"]
        assert item["actorId"] == team["member"].user_id
        assert item["emoji"] is None

    async def test_a_reaction_to_what_you_wrote_lands_with_the_emoji(
        self, team: dict[str, Any]
    ) -> None:
        mine = await send_message(team["owner"], team["general"], "shipped it")
        message_id = mine.body["message"]["id"]
        reacted = await team["member"].put(f"/api/messages/{message_id}/reactions", {"emoji": "🎉"})
        assert reacted.status == 200

        (item,) = await feed(team["owner"])
        assert item["kind"] == "reaction"
        assert item["emoji"] == "🎉"
        assert item["actorId"] == team["member"].user_id
        assert item["message"]["body"] == "shipped it"

    async def test_your_own_words_and_your_own_reactions_are_not_activity(
        self, team: dict[str, Any]
    ) -> None:
        mine = await send_message(team["owner"], team["general"], "@Owner talking to myself")
        await team["owner"].put(
            f"/api/messages/{mine.body['message']['id']}/reactions", {"emoji": "👀"}
        )
        assert await feed(team["owner"]) == []

    async def test_a_broadcast_is_a_mention_too(self, team: dict[str, Any]) -> None:
        await send_message(team["member"], team["general"], "@channel standup in five")
        (item,) = await feed(team["owner"])
        assert item["kind"] == "mention"

    async def test_a_deleted_message_takes_its_activity_with_it(self, team: dict[str, Any]) -> None:
        said = await send_message(team["member"], team["general"], "@Owner never mind")
        assert len(await feed(team["owner"])) == 1
        gone = await team["member"].delete(f"/api/messages/{said.body['message']['id']}")
        assert gone.status == 200
        assert await feed(team["owner"]) == []


class TestWhoSeesIt:
    async def test_a_mention_in_a_channel_you_are_not_in_is_not_yours_to_see(
        self, team: dict[str, Any]
    ) -> None:
        private = (
            await team["owner"].post(
                "/api/channels",
                {"name": "war-room", "kind": "private", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        # Names the outsider, who cannot read the channel — so it is not in their list.
        await send_message(team["member"], private, "@Outsider would know")
        assert await feed(team["outsider"]) == []
        # And the member who is in it sees their own mentions there normally.
        await send_message(team["owner"], private, "@Member here is the plan")
        (item,) = await feed(team["member"])
        assert item["message"]["body"] == "@Member here is the plan"

    async def test_leaving_a_channel_takes_its_activity_out_of_your_list(
        self, team: dict[str, Any]
    ) -> None:
        room = (
            await team["owner"].post(
                "/api/channels",
                {"name": "loud", "kind": "public", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        await send_message(team["owner"], room, "@Member one for you")
        assert len(await feed(team["member"])) == 1

        left = await team["member"].post(f"/api/channels/{room}/leave")
        assert left.status == 200
        assert await feed(team["member"]) == []

    async def test_muting_silences_the_broadcast_and_keeps_the_direct_one(
        self, team: dict[str, Any]
    ) -> None:
        muted = await team["owner"].patch(
            f"/api/channels/{team['general']}/membership", {"notifyLevel": "none"}
        )
        assert muted.status == 200

        await send_message(team["member"], team["general"], "@channel everybody look")
        await send_message(team["member"], team["general"], "@Owner but you especially")

        bodies = [item["message"]["body"] for item in await feed(team["owner"])]
        assert bodies == ["@Owner but you especially"]


class TestTheList:
    async def test_it_is_newest_first_and_pages_without_repeating(
        self, team: dict[str, Any]
    ) -> None:
        for n in range(7):
            await send_message(team["member"], team["general"], f"@Owner item {n}")

        seen: list[str] = []
        cursor: str | None = None
        for _ in range(5):
            query = "?limit=3" + (f"&cursor={cursor}" if cursor else "")
            answer = await team["owner"].get(f"/api/activity{query}")
            assert answer.status == 200, answer.body
            seen.extend(item["message"]["id"] for item in answer.body["items"])
            cursor = answer.body["nextCursor"]
            if not cursor:
                break

        assert cursor is None, "the walk should end rather than offer another page"
        assert len(seen) == 7 and len(set(seen)) == 7
        assert seen == sorted(seen, reverse=True), "newest first, all the way down"

    async def test_two_people_reacting_to_one_message_are_two_items(
        self, team: dict[str, Any]
    ) -> None:
        mine = await send_message(team["owner"], team["general"], "the release notes")
        message_id = mine.body["message"]["id"]
        await team["member"].put(f"/api/messages/{message_id}/reactions", {"emoji": "👍"})
        await team["outsider"].put(f"/api/messages/{message_id}/reactions", {"emoji": "🚀"})

        items = await feed(team["owner"])
        assert len(items) == 2
        assert {item["emoji"] for item in items} == {"👍", "🚀"}
        # And a page boundary between them keeps both — the cursor carries the actor.
        first = await team["owner"].get("/api/activity?limit=1")
        second = await team["owner"].get(f"/api/activity?limit=1&cursor={first.body['nextCursor']}")
        assert first.body["items"][0]["actorId"] != second.body["items"][0]["actorId"]

    async def test_it_can_be_narrowed_to_one_kind(self, team: dict[str, Any]) -> None:
        mine = await send_message(team["owner"], team["general"], "look at this")
        await team["member"].put(
            f"/api/messages/{mine.body['message']['id']}/reactions", {"emoji": "😂"}
        )
        await send_message(team["member"], team["general"], "@Owner and this")

        assert len(await feed(team["owner"])) == 2
        assert [i["kind"] for i in await feed(team["owner"], "?kind=mention")] == ["mention"]
        assert [i["kind"] for i in await feed(team["owner"], "?kind=reaction")] == ["reaction"]

    async def test_a_kind_nobody_offers_and_a_forged_cursor_are_both_refused(
        self, team: dict[str, Any]
    ) -> None:
        bad_kind = await team["owner"].get("/api/activity?kind=sideways")
        assert bad_kind.status == 400
        assert bad_kind.body["error"]["code"] == "invalid_input"

        forged = await team["owner"].get("/api/activity?cursor=notacursor")
        assert forged.status == 400
        assert "cursor" in forged.body["error"]["message"]

    async def test_an_empty_list_is_an_empty_list(self, team: dict[str, Any]) -> None:
        await send_message(team["member"], team["general"], "nothing to do with anyone")
        answer = await team["owner"].get("/api/activity")
        assert answer.status == 200
        assert answer.body == {"items": [], "nextCursor": None}


class TestStoredEvents:
    async def test_a_direct_mention_is_written_to_the_table(self, team: dict[str, Any]) -> None:
        said = await send_message(team["member"], team["general"], "@Owner can you look?")
        rows = await _stored(team["owner"].user_id)
        assert [(r.kind, str(r.message_id), str(r.actor_id)) for r in rows] == [
            ("mention", said.body["message"]["id"], team["member"].user_id)
        ]

    async def test_a_reaction_is_written_to_the_table(self, team: dict[str, Any]) -> None:
        mine = await send_message(team["owner"], team["general"], "shipped it")
        message_id = mine.body["message"]["id"]
        await team["member"].put(f"/api/messages/{message_id}/reactions", {"emoji": "🎉"})
        rows = await _stored(team["owner"].user_id)
        assert [(r.kind, r.emoji, str(r.actor_id)) for r in rows] == [
            ("reaction", "🎉", team["member"].user_id)
        ]

    async def test_a_reminder_lands_in_the_feed(self, team: dict[str, Any]) -> None:
        said = await send_message(team["member"], team["general"], "standup notes")
        workspace_id = await _workspace_of(team["owner"].user_id)
        async with SessionFactory() as session, session.begin():
            await activity_service.record(
                session,
                workspace_id=workspace_id,
                user_id=team["owner"].user_id,
                kind="reminder",
                actor_id=team["owner"].user_id,
                channel_id=team["general"],
                message_id=said.body["message"]["id"],
            )

        (item,) = await feed(team["owner"], "?kind=reminder")
        assert item["kind"] == "reminder"
        assert item["message"]["id"] == said.body["message"]["id"]
        # And it does not leak into someone else's list.
        assert await feed(team["member"], "?kind=reminder") == []

    async def test_your_own_mention_is_not_written(self, team: dict[str, Any]) -> None:
        await send_message(team["owner"], team["general"], "@Owner talking to myself")
        assert await _stored(team["owner"].user_id) == []
