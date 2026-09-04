"""Whose agent is it, and who may set it going.

Every installed agent used to be everybody's: any member could mention any of them and it
answered. That is right for the workspace's own assistant and wrong for a personal one —
an assistant that takes instructions from the whole room is not personal.

The rule this pins: an agent with no owner answers anyone, an owned one answers its owner,
and the owner can lend it to a named person in a named channel and take it back. The
refusals matter more than the grants, so most of these are refusals.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.services import agent_access

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up, workspace_id_of

APP: dict[str, Any] = {
    "slug": "assistant",
    "name": "Assistant",
    "runtime": "external",
    "version": "1.0.0",
    "aguiUrl": "https://apps.example.com/agui",
    "events": [],
    "scopes": ["messages:read", "messages:write", "channels:read"],
}


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """`apps.example.com` does not resolve, and an unresolvable host reads as private.

    The registration guard is doing its job; it just has no opinion worth testing here.
    """
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    marko = await invite_and_sign_up(owner, "Marko")
    other = await invite_and_sign_up(owner, "Other")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")

    installed = await owner.post("/api/admin/plugins", APP)
    assert installed.status == 201, installed.body
    plugin_id = installed.body["plugin"]["id"]

    async with SessionFactory() as session:
        bot_user_id = (
            await session.execute(
                sql("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
            )
        ).scalar_one()

    return {
        "owner": owner,
        "marko": marko,
        "other": other,
        "general": general["id"],
        "plugin_id": plugin_id,
        "bot_user_id": str(bot_user_id),
        "workspace_id": await workspace_id_of(owner),
    }


async def may(team: dict, actor: Client, channel_id: str | None = None) -> bool:
    """The question the run job asks before starting anything."""
    async with SessionFactory() as session:
        allowed = await agent_access.commandable_by(
            session,
            workspace_id=team["workspace_id"],
            actor_id=actor.user_id,
            channel_id=channel_id or team["general"],
            bot_user_ids=[team["bot_user_id"]],
        )
    return team["bot_user_id"] in allowed


async def give_to(team: dict, person: Client | None) -> None:
    answer = await team["owner"].put(
        f"/api/admin/plugins/{team['plugin_id']}/owner",
        {"userId": person.user_id if person else None},
    )
    assert answer.status == 200, answer.body


async def run(client: Client, channel_id: str, body: str) -> dict:
    answer = await client.post(
        "/api/commands",
        {"channelId": channel_id, "text": body, "clientMsgId": client_msg_id()},
    )
    assert answer.status == 200, answer.body
    return dict(answer.body)


class TestAnUnownedAgentIsEverybodys:
    async def test_anyone_can_command_it(self, team: dict) -> None:
        # The workspace's own assistant. Nothing changes for it, which is the point:
        # this rule must not make Janus stop answering people.
        assert await may(team, team["owner"]) is True
        assert await may(team, team["marko"]) is True
        assert await may(team, team["other"]) is True


class TestAnOwnedAgentAnswersItsOwner:
    async def test_the_owner_can(self, team: dict) -> None:
        await give_to(team, team["marko"])
        assert await may(team, team["marko"]) is True

    async def test_and_nobody_else(self, team: dict) -> None:
        await give_to(team, team["marko"])
        assert await may(team, team["other"]) is False
        # Not even an admin: an admin can take the agent away, which is a different act
        # from quietly using somebody's assistant.
        assert await may(team, team["owner"]) is False

    async def test_handing_it_back_makes_it_everybodys_again(self, team: dict) -> None:
        await give_to(team, team["marko"])
        await give_to(team, None)
        assert await may(team, team["other"]) is True


class TestLendingIt:
    async def test_the_owner_lends_it_in_a_channel(self, team: dict) -> None:
        await give_to(team, team["marko"])

        said = await run(team["marko"], team["general"], "/allow @Assistant @Other")

        assert "answers 1 more person" in said["ephemeral"]
        assert await may(team, team["other"]) is True

    async def test_and_only_in_that_channel(self, team: dict) -> None:
        await give_to(team, team["marko"])
        await run(team["marko"], team["general"], "/allow @Assistant @Other")

        made = await team["owner"].post("/api/channels", {"name": "elsewhere", "kind": "public"})
        elsewhere = made.body["channel"]["id"]

        assert await may(team, team["other"], elsewhere) is False

    async def test_and_takes_it_back(self, team: dict) -> None:
        await give_to(team, team["marko"])
        await run(team["marko"], team["general"], "/allow @Assistant @Other")

        said = await run(team["marko"], team["general"], "/disallow @Assistant @Other")

        assert "only you" in said["ephemeral"]
        assert await may(team, team["other"]) is False

    async def test_somebody_else_cannot_lend_your_agent(self, team: dict) -> None:
        await give_to(team, team["marko"])

        said = await run(team["other"], team["general"], "/allow @Assistant @Other")

        assert "not yours to lend" in said["ephemeral"]
        assert await may(team, team["other"]) is False

    async def test_the_workspace_agent_needs_no_lending(self, team: dict) -> None:
        said = await run(team["owner"], team["general"], "/allow @Assistant @Other")

        assert "everybody can already use it" in said["ephemeral"]

    async def test_naming_a_person_first_is_a_gentle_refusal(self, team: dict) -> None:
        await give_to(team, team["marko"])

        said = await run(team["marko"], team["general"], "/allow @Other")

        assert "Name the agent first" in said["ephemeral"]

    async def test_listing_who_can(self, team: dict) -> None:
        await give_to(team, team["marko"])
        await run(team["marko"], team["general"], "/allow @Assistant @Other")

        said = await run(team["marko"], team["general"], "/allow @Assistant")

        assert "also answers Other" in said["ephemeral"]

    async def test_lending_twice_is_not_an_error(self, team: dict) -> None:
        # The unique index is on live rows; somebody saying it again should hear the same
        # answer rather than a database error.
        await give_to(team, team["marko"])
        await run(team["marko"], team["general"], "/allow @Assistant @Other")

        said = await run(team["marko"], team["general"], "/allow @Assistant @Other")

        assert "answers 1 more person" in said["ephemeral"]
        assert await may(team, team["other"]) is True

    async def test_it_can_be_granted_again_after_being_taken_back(self, team: dict) -> None:
        await give_to(team, team["marko"])
        await run(team["marko"], team["general"], "/allow @Assistant @Other")
        await run(team["marko"], team["general"], "/disallow @Assistant @Other")

        await run(team["marko"], team["general"], "/allow @Assistant @Other")

        assert await may(team, team["other"]) is True


class TestOwnership:
    async def test_only_an_admin_assigns_an_owner(self, team: dict) -> None:
        refused = await team["marko"].put(
            f"/api/admin/plugins/{team['plugin_id']}/owner", {"userId": team["marko"].user_id}
        )
        assert refused.status == 403

    async def test_an_owner_has_to_be_in_the_workspace(self, team: dict) -> None:
        refused = await team["owner"].put(
            f"/api/admin/plugins/{team['plugin_id']}/owner",
            {"userId": "01a06bee-0000-7000-8000-000000000000"},
        )
        assert refused.status == 400

    async def test_a_bot_cannot_own_an_agent(self, team: dict) -> None:
        # The console filters bots out of the picker; this is why it can.
        refused = await team["owner"].put(
            f"/api/admin/plugins/{team['plugin_id']}/owner",
            {"userId": team["bot_user_id"]},
        )
        assert refused.status == 400

    async def test_the_console_can_see_who_owns_an_agent(self, team: dict) -> None:
        """The list is what the Owner control reads to know where it stands.

        Without this the route wrote a value nothing could read back, and the picker
        would have shown "the workspace" for an agent that had an owner — which is the
        one thing an ownership control must never get wrong.
        """
        await give_to(team, team["marko"])

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]

        mine = next(row for row in listed if row["id"] == team["plugin_id"])
        assert mine["ownerUserId"] == team["marko"].user_id

        await give_to(team, None)
        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        assert next(row for row in listed if row["id"] == team["plugin_id"])["ownerUserId"] is None
