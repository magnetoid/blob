"""The channel directory.

What it is for is discovery, which makes the interesting cases the ones about what it
must *not* show. A private channel the asker is not in cannot appear at all — its
existence is private, which is why opening one answers 404 rather than 403 — and neither
can a channel from another workspace.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    return {"owner": owner, "member": member}


async def browse(client: Client, query: str = "", archived: bool = False) -> list[dict]:
    url = f"/api/channels/browse?q={query}&archived={'true' if archived else 'false'}"
    answer = await client.get(url)
    assert answer.status == 200, answer.body
    return answer.body["channels"]


class TestWhatTheDirectoryShows:
    async def test_it_lists_public_channels_with_a_member_count(self, team: dict) -> None:
        listed = await browse(team["member"])

        assert listed, "the seeded workspace has public channels"
        general = next(c for c in listed if c["name"] == "general")
        assert general["memberCount"] >= 2
        assert general["joined"] is True

    async def test_a_channel_you_are_not_in_is_offered_to_join(self, team: dict) -> None:
        made = await team["owner"].post("/api/channels", {"name": "watercooler", "kind": "public"})
        assert made.status == 200, made.body

        listed = await browse(team["member"], "watercooler")

        entry = next(c for c in listed if c["name"] == "watercooler")
        assert entry["joined"] is False
        assert entry["memberCount"] == 1

    async def test_search_matches_name_description_and_topic(self, team: dict) -> None:
        await team["owner"].post(
            "/api/channels",
            {"name": "logistics", "kind": "public", "description": "shipping and pallets"},
        )

        by_name = await browse(team["member"], "logist")
        by_description = await browse(team["member"], "pallets")

        assert [c["name"] for c in by_name] == ["logistics"]
        assert [c["name"] for c in by_description] == ["logistics"]

    async def test_archived_channels_are_out_unless_asked_for(self, team: dict) -> None:
        made = await team["owner"].post("/api/channels", {"name": "retired", "kind": "public"})
        channel_id = made.body["channel"]["id"]
        archived = await team["owner"].post(f"/api/channels/{channel_id}/archive", {})
        assert archived.status in (200, 204), archived.body

        assert "retired" not in [c["name"] for c in await browse(team["member"])]
        assert "retired" in [c["name"] for c in await browse(team["member"], archived=True)]


class TestWhatItMustNotShow:
    async def test_a_private_channel_you_are_not_in_is_invisible(self, team: dict) -> None:
        # Not "shown but unjoinable" — absent. Its existence is the private part.
        await team["owner"].post("/api/channels", {"name": "leadership", "kind": "private"})

        listed = await browse(team["member"], "leadership")

        assert listed == []

    async def test_a_private_channel_you_are_in_is_not_listed_either(self, team: dict) -> None:
        # It is already in their sidebar; repeating it here is noise, not discovery.
        await team["owner"].post("/api/channels", {"name": "owners-den", "kind": "private"})

        listed = await browse(team["owner"], "owners-den")

        assert listed == []

    async def test_another_workspace_cannot_be_browsed_into(self, team: dict) -> None:
        # The boundary is inside the statement, so standing in the other workspace is
        # the honest way to ask whether it holds.
        owner = team["owner"]
        here = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
        await owner.post("/api/channels", {"name": "ours-only", "kind": "public"})
        created = await owner.post("/api/admin/instance/workspaces", {"name": "Second"})
        assert created.status in (200, 201), created.body
        assert (await owner.post(f"/api/workspaces/{created.body['id']}/switch")).status == 200

        listed = await browse(owner, "ours-only")

        assert listed == []
        assert (await owner.post(f"/api/workspaces/{here}/switch")).status == 200


class TestArchivingIsReversible:
    """Archiving had no undo anywhere — and no gate on the route, either.

    The client hid "Archive channel" from members and the REST route accepted it from any
    of them, which is a rule enforced in the one place that cannot enforce it. And nothing
    in the repository ever set `archived_at` back to null: no route, no command, no
    console control. The history stayed intact and simply became unwritable for ever.
    """

    @staticmethod
    async def a_channel(team: dict, name: str) -> str:
        made = await team["owner"].post("/api/channels", {"name": name, "kind": "public"})
        assert made.status == 200, made.body
        return str(made.body["channel"]["id"])

    async def test_a_member_cannot_archive(self, team: dict) -> None:
        channel_id = await self.a_channel(team, "gate-check")
        await team["member"].post(f"/api/channels/{channel_id}/join")

        refused = await team["member"].post(f"/api/channels/{channel_id}/archive", {})

        assert refused.status == 403, refused.body

    async def test_an_admin_can_reopen_one(self, team: dict) -> None:
        channel_id = await self.a_channel(team, "reopen-me")
        await team["owner"].post(f"/api/channels/{channel_id}/archive", {})

        back = await team["owner"].post(f"/api/channels/{channel_id}/unarchive", {})

        assert back.status == 200, back.body
        assert back.body["channel"]["archivedAt"] is None
        # And it takes messages again, which is the whole point.
        sent = await team["owner"].post(
            f"/api/channels/{channel_id}/messages",
            {"body": "open again", "clientMsgId": client_msg_id()},
        )
        assert sent.status == 201, sent.body

    async def test_a_member_cannot_reopen_one(self, team: dict) -> None:
        channel_id = await self.a_channel(team, "not-yours")
        await team["member"].post(f"/api/channels/{channel_id}/join")
        await team["owner"].post(f"/api/channels/{channel_id}/archive", {})

        refused = await team["member"].post(f"/api/channels/{channel_id}/unarchive", {})

        assert refused.status == 403, refused.body
