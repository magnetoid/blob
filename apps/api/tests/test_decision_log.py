"""The decision log (M2 · A8): what a conversation settled, kept where everyone can find it.

A decision rests on the message it was settled in and lives under that message's channel:
listed for the channel's members, a 404 to anybody else, as the channel is. A person
records one from a message, from `/decision`, or through their assistant; it is revoked,
never deleted; only its recorder or an admin changes it; and every write is idempotent on
the client's id. A message is the source of at most one standing decision, and says so.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, send_message, sign_up
from .test_mcp import MODERN, Mcp, mint


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    private = await owner.post(
        "/api/channels",
        {"name": "board", "kind": "private", "memberIds": [member.user_id]},
    )
    assert private.status in (200, 201), private.body
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "general": general,
        "private": private.body["channel"]["id"],
    }


async def record(who: Client, channel_id: str, title: str, **extra: Any) -> Any:
    return await who.post(
        f"/api/channels/{channel_id}/decisions",
        {"title": title, "clientId": extra.pop("clientId", str(uuid.uuid4())), **extra},
    )


async def message_of(who: Client, channel_id: str, message_id: str) -> dict[str, Any]:
    listed = await who.get(f"/api/channels/{channel_id}/messages")
    return next(m for m in listed.body["messages"] if m["id"] == message_id)


class TestRecording:
    async def test_a_decision_rests_on_its_message_and_the_message_says_so(
        self, team: dict[str, Any]
    ) -> None:
        said = await send_message(team["member"], team["general"], "Let's ship on Friday.")
        message_id = said.body["message"]["id"]
        made = await record(
            team["member"],
            team["general"],
            "Ship on Friday",
            rationale="QA signs off Thursday.",
            messageId=message_id,
        )
        assert made.status == 200, made.body
        decision = made.body
        assert decision["title"] == "Ship on Friday"
        assert decision["rationale"] == "QA signs off Thursday."
        assert decision["messageId"] == message_id
        assert decision["decidedBy"] == team["member"].user_id
        assert decision["channelName"] == "general"
        assert decision["proposedBy"] is None and decision["revokedAt"] is None

        shown = await message_of(team["owner"], team["general"], message_id)
        assert shown["decisionId"] == decision["id"]
        listed = await team["owner"].get("/api/decisions")
        assert [d["id"] for d in listed.body["decisions"]] == [decision["id"]]

    async def test_the_same_client_id_records_once(self, team: dict[str, Any]) -> None:
        key = str(uuid.uuid4())
        first = await record(team["owner"], team["general"], "Use Postgres", clientId=key)
        again = await record(team["owner"], team["general"], "Use Postgres", clientId=key)
        assert again.status == 200 and again.body["id"] == first.body["id"]
        stolen = await record(team["member"], team["general"], "Use MySQL", clientId=key)
        assert stolen.status == 409

    async def test_a_message_is_one_standing_decision_at_a_time(self, team: dict[str, Any]) -> None:
        said = await send_message(team["owner"], team["general"], "Monday standups move to 10.")
        message_id = said.body["message"]["id"]
        first = await record(team["owner"], team["general"], "Standups at 10", messageId=message_id)
        twice = await record(team["owner"], team["general"], "Standups at 10", messageId=message_id)
        assert twice.status == 409 and twice.body["error"]["code"] == "already_decided"

        revoked = await team["owner"].post(
            f"/api/decisions/{first.body['id']}/revoke", {"revoked": True}
        )
        assert revoked.status == 200 and revoked.body["revokedAt"]
        shown = await message_of(team["owner"], team["general"], message_id)
        assert shown["decisionId"] is None

        second = await record(
            team["owner"], team["general"], "Standups at 11", messageId=message_id
        )
        assert second.status == 200
        restored = await team["owner"].post(
            f"/api/decisions/{first.body['id']}/revoke", {"revoked": False}
        )
        assert restored.status == 409

    async def test_what_is_refused(self, team: dict[str, Any]) -> None:
        assert (await record(team["owner"], team["general"], "   ")).status == 400
        assert (await record(team["owner"], team["general"], "x" * 201)).status == 400
        too_long_why = await record(team["owner"], team["general"], "Fine", rationale="y" * 2001)
        assert too_long_why.status == 400
        elsewhere = await send_message(team["member"], team["private"], "board stuff")
        wrong_place = await record(
            team["owner"],
            team["general"],
            "From another room",
            messageId=elsewhere.body["message"]["id"],
        )
        assert wrong_place.status == 404


class TestWhoSeesIt:
    async def test_a_private_channels_decisions_are_as_private_as_its_messages(
        self, team: dict[str, Any]
    ) -> None:
        made = await record(team["member"], team["private"], "Raise the price")
        assert made.status == 200, made.body
        assert (await team["outsider"].get("/api/decisions")).body["decisions"] == []
        assert (await team["outsider"].get(f"/api/decisions/{made.body['id']}")).status == 404
        refused = await record(team["outsider"], team["private"], "Lower the price")
        assert refused.status == 404
        mine = await team["member"].get("/api/decisions")
        assert [d["title"] for d in mine.body["decisions"]] == ["Raise the price"]

    async def test_only_its_recorder_or_an_admin_changes_it(self, team: dict[str, Any]) -> None:
        made = await record(team["member"], team["general"], "Weekly demos")
        url = f"/api/decisions/{made.body['id']}"
        outsider = await team["outsider"].patch(url, {"title": "Daily demos"})
        assert outsider.status == 403
        mine = await team["member"].patch(url, {"rationale": "Keeps us honest."})
        assert mine.status == 200 and mine.body["rationale"] == "Keeps us honest."
        admin = await team["owner"].patch(url, {"title": "Weekly demos, Fridays"})
        assert admin.status == 200 and admin.body["title"] == "Weekly demos, Fridays"


class TestFinding:
    async def test_by_words_by_channel_and_revoked_only_when_asked(
        self, team: dict[str, Any]
    ) -> None:
        a = await record(team["owner"], team["general"], "Adopt TypeScript", rationale="Types.")
        await record(team["owner"], team["general"], "Keep the monorepo")
        c = await record(team["member"], team["private"], "Hire a designer")
        await team["owner"].post(f"/api/decisions/{a.body['id']}/revoke", {"revoked": True})

        def titles(body: dict[str, Any]) -> list[str]:
            return [d["title"] for d in body["decisions"]]

        assert titles((await team["member"].get("/api/decisions")).body) == [
            "Hire a designer",
            "Keep the monorepo",
        ]
        withdrawn = await team["member"].get("/api/decisions?revoked=true")
        assert "Adopt TypeScript" in titles(withdrawn.body)
        assert titles((await team["member"].get("/api/decisions?q=monorepo")).body) == [
            "Keep the monorepo"
        ]
        only = await team["member"].get(f"/api/decisions?channelId={team['private']}")
        assert [d["id"] for d in only.body["decisions"]] == [c.body["id"]]
        paged = await team["member"].get("/api/decisions?limit=1")
        assert len(paged.body["decisions"]) == 1 and paged.body["nextBefore"]
        rest = await team["member"].get(f"/api/decisions?limit=1&before={paged.body['nextBefore']}")
        assert titles(rest.body) == ["Keep the monorepo"]
        bad = await team["member"].get("/api/decisions?channelId=not-an-id")
        assert bad.status == 400


class TestTheCommand:
    async def test_slash_decision_posts_it_and_records_it(self, team: dict[str, Any]) -> None:
        ran = await team["owner"].post(
            "/api/commands",
            {
                "channelId": team["general"],
                "text": "/decision We move the launch to May",
                "clientMsgId": client_msg_id(),
            },
        )
        assert ran.status == 200, ran.body
        posted = ran.body["message"]
        assert posted["body"] == "We move the launch to May"
        assert posted["decisionId"]
        [decision] = (await team["member"].get("/api/decisions")).body["decisions"]
        assert decision["id"] == posted["decisionId"]
        assert decision["messageId"] == posted["id"]

    async def test_slash_decision_says_what_it_needs(self, team: dict[str, Any]) -> None:
        for text_ in ("/decision", "/decision " + "x" * 201):
            ran = await team["owner"].post(
                "/api/commands",
                {"channelId": team["general"], "text": text_, "clientMsgId": client_msg_id()},
            )
            assert ran.status == 200
            assert ran.body["message"] is None and ran.body["ephemeral"]
        assert (await team["owner"].get("/api/decisions")).body["decisions"] == []


class TestAnAssistant:
    async def test_an_assistant_records_and_lists_as_its_person(self, team: dict[str, Any]) -> None:
        said = await send_message(team["member"], team["general"], "We'll use Fly.io.")
        secret = await mint(team["member"], can_write=True)
        mcp = Mcp(team["member"].fork(), secret, era=MODERN)
        answer = await mcp.call(
            "record_decision",
            {
                "channel": "#general",
                "title": "Host on Fly.io",
                "rationale": "Cheaper than the alternative.",
                "message_id": said.body["message"]["id"],
            },
        )
        assert "Recorded in #general" in answer
        listed = await mcp.call("list_decisions", {"query": "fly"})
        assert "Host on Fly.io" in listed and "Why: Cheaper" in listed
        [decision] = (await team["owner"].get("/api/decisions")).body["decisions"]
        assert decision["decidedBy"] == team["member"].user_id

    async def test_a_reading_assistant_may_not_record(self, team: dict[str, Any]) -> None:
        secret = await mint(team["member"])
        mcp = Mcp(team["member"].fork(), secret, era=MODERN)
        refused = await mcp.refuse("record_decision", {"channel": "#general", "title": "No"})
        assert "only read" in refused
