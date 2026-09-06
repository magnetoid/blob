"""What a channel frame may say about you, and to whom.

`ChannelWithState` is the sidebar's shape: the channel plus *this reader's* membership,
unread flag, mention count and read cursor. Broadcast to a room it was the editor's
state, and the client replaced its copy wholesale — so a topic edit moved everyone
else's unread line, and an admin reopening a channel they were not in told the members
they had no membership. These pin the split: the room gets the channel, you get your
standing in it.
"""

from __future__ import annotations

from typing import Any

import pytest_asyncio

from blob_api.realtime import hub

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of

#: The per-viewer fields. None of them may appear in a frame sent to a room.
PERSONAL = ("membership", "hasUnread", "mentionCount", "lastReadMessageId")


def watcher(name: str, user_id: str, workspace_id: str, channel_ids: list[str]) -> Any:
    conn = hub.new_connection(name, user_id, workspace_id)
    hub.register(conn)
    hub.subscribe_channels(conn, channel_ids)
    return conn


def frames(conn: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while True:
        try:
            out.append(conn.outbox.get_nowait())
        except Exception:
            return out


def of_kind(conn: Any, kind: str) -> list[dict[str, Any]]:
    return [frame for frame in frames(conn) if frame["t"] == kind]


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    workspace_id = await workspace_id_of(owner)
    return {"owner": owner, "member": member, "general": general, "workspace_id": workspace_id}


class TestWhatTheRoomIsTold:
    async def test_a_topic_edit_carries_the_channel_and_nobody_s_standing_in_it(
        self, team: dict[str, Any]
    ) -> None:
        conn = watcher("m1", team["member"].user_id, team["workspace_id"], [team["general"]])
        edited = await team["owner"].patch(
            f"/api/channels/{team['general']}", {"topic": "Deploys and dread"}
        )
        assert edited.status == 200

        (frame,) = of_kind(conn, "channel.updated")
        assert frame["channel"]["topic"] == "Deploys and dread"
        assert frame["channel"]["id"] == team["general"]
        for field in PERSONAL:
            assert field not in frame["channel"], f"{field} reached the room"

    async def test_reopening_a_channel_the_admin_is_not_in_says_nothing_about_membership(
        self, team: dict[str, Any]
    ) -> None:
        room = (
            await team["owner"].post(
                "/api/channels",
                {"name": "vault", "kind": "public", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        assert (await team["owner"].post(f"/api/channels/{room}/archive")).status == 200
        # The admin steps out, so their view of it carries no membership at all.
        assert (await team["owner"].post(f"/api/channels/{room}/leave")).status == 200

        conn = watcher("m2", team["member"].user_id, team["workspace_id"], [room])
        reopened = await team["owner"].post(f"/api/admin/channels/{room}/unarchive")
        assert reopened.status == 200, reopened.body

        (frame,) = of_kind(conn, "channel.updated")
        assert frame["channel"]["archivedAt"] is None
        for field in PERSONAL:
            assert field not in frame["channel"]

    async def test_a_new_public_channel_reaches_the_workspace_without_a_membership(
        self, team: dict[str, Any]
    ) -> None:
        outsider = watcher("m3", team["member"].user_id, team["workspace_id"], [])
        creator = watcher("m4", team["owner"].user_id, team["workspace_id"], [])

        made = await team["owner"].post("/api/channels", {"name": "newsroom", "kind": "public"})
        assert made.status == 200, made.body

        (announced,) = of_kind(outsider, "channel.created")
        assert announced["channel"]["name"] == "newsroom"
        for field in PERSONAL:
            assert field not in announced["channel"]
        # The person who is not in it is told nothing about being in it.
        assert of_kind(outsider, "channel.membership") == []

        # The creator gets both halves: the channel, and that they are in it.
        creator_frames = frames(creator)
        kinds = [frame["t"] for frame in creator_frames]
        assert "channel.created" in kinds and "channel.membership" in kinds
        mine = next(f for f in creator_frames if f["t"] == "channel.membership")
        assert mine["channelId"] == made.body["channel"]["id"]
        assert mine["membership"]["notifyLevel"] == "mentions"
        assert mine["hasUnread"] is False and mine["mentionCount"] == 0

    async def test_being_added_brings_the_channel_and_your_standing_in_it(
        self, team: dict[str, Any]
    ) -> None:
        private = (
            await team["owner"].post(
                "/api/channels", {"name": "war-room", "kind": "private", "memberIds": []}
            )
        ).body["channel"]["id"]
        conn = watcher("m5", team["member"].user_id, team["workspace_id"], [])

        added = await team["owner"].post(
            f"/api/channels/{private}/members", {"userIds": [team["member"].user_id]}
        )
        assert added.status == 200, added.body

        got = frames(conn)
        created = next(f for f in got if f["t"] == "channel.created")
        assert created["channel"]["name"] == "war-room"
        for field in PERSONAL:
            assert field not in created["channel"]
        mine = next(f for f in got if f["t"] == "channel.membership")
        assert mine["channelId"] == private and mine["membership"] is not None


class TestWhatOnlyYouAreTold:
    async def test_muting_a_channel_is_told_to_you_and_to_nobody_else(
        self, team: dict[str, Any]
    ) -> None:
        mine = watcher("m6", team["owner"].user_id, team["workspace_id"], [team["general"]])
        theirs = watcher("m7", team["member"].user_id, team["workspace_id"], [team["general"]])

        muted = await team["owner"].patch(
            f"/api/channels/{team['general']}/membership", {"notifyLevel": "none"}
        )
        assert muted.status == 200

        (frame,) = of_kind(mine, "channel.membership")
        assert frame["channelId"] == team["general"]
        assert frame["membership"]["notifyLevel"] == "none"
        # Nothing at all for the other member: the channel did not change.
        assert frames(theirs) == []

    async def test_the_slash_command_that_mutes_tells_the_same_person_the_same_thing(
        self, team: dict[str, Any]
    ) -> None:
        mine = watcher("m8", team["owner"].user_id, team["workspace_id"], [team["general"]])
        theirs = watcher("m9", team["member"].user_id, team["workspace_id"], [team["general"]])

        ran = await team["owner"].post(
            "/api/commands",
            {"channelId": team["general"], "text": "/mute", "clientMsgId": "cmd-mute-1"},
        )
        assert ran.status == 200, ran.body

        (frame,) = of_kind(mine, "channel.membership")
        assert frame["membership"]["notifyLevel"] == "none"
        assert of_kind(theirs, "channel.membership") == []

    async def test_a_topic_command_tells_the_room_about_the_channel_only(
        self, team: dict[str, Any]
    ) -> None:
        theirs = watcher("m10", team["member"].user_id, team["workspace_id"], [team["general"]])
        ran = await team["owner"].post(
            "/api/commands",
            {"channelId": team["general"], "text": "/topic Ship it", "clientMsgId": "cmd-topic-1"},
        )
        assert ran.status == 200, ran.body

        (frame,) = of_kind(theirs, "channel.updated")
        assert frame["channel"]["topic"] == "Ship it"
        for field in PERSONAL:
            assert field not in frame["channel"]

    async def test_an_edit_does_not_disturb_what_the_room_had_read(
        self, team: dict[str, Any]
    ) -> None:
        """The bug this all exists for: the editor's read cursor is not everyone's."""
        await send_message(team["owner"], team["general"], "something to be unread")
        before = next(
            c
            for c in (await team["member"].get("/api/channels")).body["channels"]
            if c["id"] == team["general"]
        )
        assert before["hasUnread"] is True

        await team["owner"].patch(f"/api/channels/{team['general']}", {"topic": "Anything"})

        after = next(
            c
            for c in (await team["member"].get("/api/channels")).body["channels"]
            if c["id"] == team["general"]
        )
        assert after["hasUnread"] is True
        assert after["membership"]["notifyLevel"] == before["membership"]["notifyLevel"]
