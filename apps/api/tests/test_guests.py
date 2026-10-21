"""Guests (M3 · B1, ADR 0034): in a workspace for the channels they were invited to, and
nothing else — no public channel they were not let into, no directory, no agents, no
tokens. Tested from the guest's side of every door they could try.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.realtime import hub

from .helpers import PASSWORD, Client, invite_and_sign_up, send_message, sign_up
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import desk_fixture  # noqa: F401 — the fake agent and its room


async def make_channel(owner: Client, name: str, kind: str = "public", members: Any = ()) -> str:
    made = await owner.post(
        "/api/channels", {"name": name, "kind": kind, "memberIds": list(members)}
    )
    assert made.status == 200, made.body
    return str(made.body["channel"]["id"])


async def invite_guest(
    owner: Client, channels: list[str], email: str = "guest@example.com"
) -> Client:
    invite = await owner.post(
        "/api/invites", {"email": email, "role": "guest", "channelIds": channels}
    )
    assert invite.status == 200, invite.body
    token = invite.body["url"].split("/join/")[1]
    guest = owner.fork()
    joined = await guest.post(
        "/api/auth/signup",
        {"email": email, "password": PASSWORD, "displayName": "Gita Guest", "inviteToken": token},
    )
    assert joined.status == 200, joined.body
    guest.user_id = joined.body["user"]["id"]
    return guest


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c["id"] for c in channels if c["name"] == "general")
    project = await make_channel(owner, "project")
    secret = await make_channel(owner, "secret", "private", [member.user_id])
    await send_message(owner, general, "the whole team's news")
    await send_message(owner, project, "the project's news")
    guest = await invite_guest(owner, [project])
    return {
        "owner": owner,
        "member": member,
        "guest": guest,
        "general": general,
        "project": project,
        "secret": secret,
    }


# ─── the invitation ───────────────────────────────────────────────────────────


class TestTheInvitation:
    async def test_a_guest_is_somebody_in_particular_let_into_particular_rooms(
        self, team: dict[str, Any]
    ) -> None:
        owner = team["owner"]
        no_address = await owner.post(
            "/api/invites", {"role": "guest", "channelIds": [team["project"]]}
        )
        assert no_address.status == 400
        no_rooms = await owner.post("/api/invites", {"email": "g2@example.com", "role": "guest"})
        assert no_rooms.status == 400
        not_a_guest = await owner.post(
            "/api/invites", {"email": "m@example.com", "channelIds": [team["project"]]}
        )
        assert not_a_guest.status == 400

    async def test_only_rooms_the_inviter_can_see(self, team: dict[str, Any]) -> None:
        admin = await invite_and_sign_up(team["owner"], "Admin", "admin")
        # #secret is private and the admin is not in it.
        refused = await admin.post(
            "/api/invites",
            {"email": "g2@example.com", "role": "guest", "channelIds": [team["secret"]]},
        )
        assert refused.status == 400

    async def test_a_member_cannot_invite_one(self, team: dict[str, Any]) -> None:
        refused = await team["member"].post(
            "/api/invites",
            {"email": "g2@example.com", "role": "guest", "channelIds": [team["project"]]},
        )
        assert refused.status == 403


# ─── channels ─────────────────────────────────────────────────────────────────


class TestChannels:
    async def test_their_sidebar_is_their_channels(self, team: dict[str, Any]) -> None:
        boot = (await team["guest"].get("/api/bootstrap")).body
        assert boot["user"]["role"] == "guest"
        assert [c["name"] for c in boot["channels"]] == ["project"]
        listed = (await team["guest"].get("/api/channels")).body["channels"]
        assert [c["name"] for c in listed] == ["project"]

    async def test_a_public_channel_they_were_not_let_into_is_not_there(
        self, team: dict[str, Any]
    ) -> None:
        guest, general = team["guest"], team["general"]
        assert (await guest.get(f"/api/channels/{general}")).status == 404
        assert (await guest.get(f"/api/channels/{general}/messages")).status == 404
        assert (await guest.post(f"/api/channels/{general}/join")).status == 404
        assert (await guest.get("/api/channels/browse")).body["channels"] == []

    async def test_nor_by_name(self, team: dict[str, Any]) -> None:
        joined = await team["guest"].post(
            f"/api/channels/{team['project']}/commands",
            {"command": "/join", "text": "#general", "clientCommandId": "join-general-1"},
        )
        assert joined.status in (200, 404), joined.body
        boot = (await team["guest"].get("/api/bootstrap")).body
        assert [c["name"] for c in boot["channels"]] == ["project"]

    async def test_they_cannot_make_rooms_or_bring_people_in(self, team: dict[str, Any]) -> None:
        guest = team["guest"]
        made = await guest.post("/api/channels", {"name": "mine", "kind": "public"})
        assert made.status == 403
        added = await guest.post(
            f"/api/channels/{team['project']}/members", {"userIds": [team["member"].user_id]}
        )
        assert added.status == 403

    async def test_search_finds_only_their_rooms(self, team: dict[str, Any]) -> None:
        found = (await team["guest"].get("/api/search?q=news")).body
        assert [message["body"] for message in found["messages"]] == ["the project's news"]


# ─── people ───────────────────────────────────────────────────────────────────


class TestPeople:
    async def test_the_directory_is_the_people_in_their_rooms(self, team: dict[str, Any]) -> None:
        guest = team["guest"]
        boot = (await guest.get("/api/bootstrap")).body
        assert sorted(u["displayName"] for u in boot["users"]) == ["Gita Guest", "Owner"]
        listed = (await guest.get("/api/users")).body["users"]
        assert sorted(u["displayName"] for u in listed) == ["Gita Guest", "Owner"]
        assert (await guest.get(f"/api/users/{team['member'].user_id}")).status == 404

    async def test_a_member_still_sees_the_guest(self, team: dict[str, Any]) -> None:
        listed = (await team["member"].get("/api/users")).body["users"]
        assert "Gita Guest" in {u["displayName"] for u in listed}

    async def test_messages_go_to_people_they_share_a_room_with(self, team: dict[str, Any]) -> None:
        guest = team["guest"]
        stranger = await guest.post("/api/dms", {"userIds": [team["member"].user_id]})
        assert stranger.status == 404
        colleague = await guest.post("/api/dms", {"userIds": [team["owner"].user_id]})
        assert colleague.status == 200, colleague.body
        # And a member may write to the guest.
        back = await team["member"].post("/api/dms", {"userIds": [guest.user_id]})
        assert back.status == 200, back.body


# ─── what reaches past their rooms ────────────────────────────────────────────


class TestReach:
    async def test_no_tokens_and_no_agents_of_their_own(self, team: dict[str, Any]) -> None:
        guest = team["guest"]
        assert (await guest.post("/api/me/mcp-tokens", {"name": "x"})).status == 403
        assert (await guest.post("/api/agents/mine", {"name": "Laptop agent"})).status == 403
        assert (await guest.get("/api/agents")).body["agents"] == []

    async def test_workspace_news_does_not_reach_their_socket(self) -> None:
        member_conn = hub.new_connection("c-member", "u-member", "w1")
        guest_conn = hub.new_connection("c-guest", "u-guest", "w1", guest=True)
        hub.register(member_conn)
        hub.register(guest_conn)
        try:
            hub.to_workspace("w1", {"t": "channel.created", "channel": {"name": "launch"}})
            assert member_conn.outbox.qsize() == 1
            assert guest_conn.outbox.qsize() == 0
        finally:
            hub.unregister(member_conn)
            hub.unregister(guest_conn)

    async def test_becoming_a_guest_ends_what_a_member_had_connected(
        self, team: dict[str, Any]
    ) -> None:
        member = team["member"]
        minted = await member.post("/api/me/mcp-tokens", {"name": "Editor"})
        assert minted.status == 200, minted.body
        demoted = await team["owner"].put(
            f"/api/admin/users/{member.user_id}/role", {"role": "guest"}
        )
        assert demoted.status == 200, demoted.body
        async with SessionFactory() as session:
            live = (
                await session.execute(
                    text("SELECT count(*) FROM mcp_tokens WHERE revoked_at IS NULL")
                )
            ).scalar()
        assert live == 0
        # Still in the rooms they had joined as a member; #project, which they never
        # joined, is gone from what they can see.
        names = {c["name"] for c in (await member.get("/api/channels")).body["channels"]}
        assert "general" in names and "project" not in names


@pytest.mark.usefixtures("desk")
class TestAgents:
    async def test_a_guests_mention_starts_no_run(self, desk: dict[str, Any]) -> None:
        guest = await invite_guest(desk["owner"], [desk["general"]], email="g@example.com")
        sent = await send_message(guest, desk["general"], "@Helper help me")
        assert sent.status == 201, sent.body
        assert ("agui_run", sent.body["message"]["id"]) not in desk["enqueued"]
        # The same words from a member do.
        mine = await send_message(desk["member"], desk["general"], "@Helper help me")
        assert ("agui_run", mine.body["message"]["id"]) in desk["enqueued"]
