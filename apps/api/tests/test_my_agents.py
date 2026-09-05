"""A member attaches their own agent.

Every install route was an admin's, so a personal agent meant an admin installing one and
handing it over. These pin the member's door: a plain member names an agent and gets a
token; the agent is theirs from the first mention (`owner_user_id` set in the same
transaction, so the ownership gate that already exists does the rest); the policy an
admin set still applies; and everything under `/mine/{id}` answers 404 for an agent that
is somebody else's, because whose agent something is stays private.
"""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.routers.my_agents import PERSONAL_SCOPES
from blob_api.services import agent_access

from .helpers import Client, allow_policy, invite_and_sign_up, sign_up, workspace_id_of


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    marko = await invite_and_sign_up(owner, "Marko")
    ana = await invite_and_sign_up(owner, "Ana")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    return {
        "owner": owner,
        "marko": marko,
        "ana": ana,
        "general": general,
        "workspace_id": await workspace_id_of(owner),
    }


async def attach(who: Client, name: str = "Desktop Claude") -> dict:
    answer = await who.post("/api/agents/mine", {"name": name})
    assert answer.status == 201, answer.body
    return dict(answer.body)


async def plugin_row(plugin_id: str) -> dict:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT p.slug, p.runtime, p.owner_user_id, p.installed_by, p.status,
                           array_agg(g.scope ORDER BY g.scope) AS scopes
                      FROM plugins p LEFT JOIN plugin_grants g ON g.plugin_id = p.id
                     WHERE p.id = :id GROUP BY p.id
                    """
                ),
                {"id": plugin_id},
            )
        ).fetchone()
    assert row is not None
    return dict(row._mapping)


class TestAttaching:
    async def test_a_member_gets_an_agent_that_is_theirs(self, team: dict) -> None:
        attached = await attach(team["marko"])

        agent = attached["agent"]
        assert attached["botToken"].startswith("blob-bot-")
        assert attached["signingSecret"]
        assert agent["online"] is False
        row = await plugin_row(agent["id"])
        assert row["runtime"] == "socket"
        assert str(row["owner_user_id"]) == team["marko"].user_id
        assert str(row["installed_by"]) == team["marko"].user_id
        assert row["slug"] == "desktop-claude"
        # The four an answering agent needs, and not one the member chose.
        assert row["scopes"] == sorted(PERSONAL_SCOPES)

    async def test_and_it_answers_only_them_from_the_first_mention(self, team: dict) -> None:
        # No second step, no admin: the ownership gate that already exists reads the
        # column this route set, so Ana mentioning Marko's agent does nothing.
        attached = await attach(team["marko"])
        bot_user_id = attached["agent"]["botUserId"]

        async with SessionFactory() as session:

            async def may(actor: Client) -> bool:
                allowed = await agent_access.commandable_by(
                    session,
                    workspace_id=team["workspace_id"],
                    actor_id=actor.user_id,
                    channel_id=team["general"],
                    bot_user_ids=[bot_user_id],
                )
                return bot_user_id in allowed

            assert await may(team["marko"]) is True
            assert await may(team["ana"]) is False
            assert await may(team["owner"]) is False

    async def test_two_agents_with_the_same_name_get_distinct_slugs(self, team: dict) -> None:
        first = await attach(team["marko"], "Helper")
        second = await attach(team["ana"], "Helper")

        assert first["agent"]["slug"] == "helper"
        assert second["agent"]["slug"] == "helper-2"

    async def test_a_name_too_short_to_slug_is_refused(self, team: dict) -> None:
        refused = await team["marko"].post("/api/agents/mine", {"name": "!!"})
        assert refused.status == 400

    async def test_the_bridge_is_downloadable_by_a_member(self, team: dict) -> None:
        answer = await team["marko"].get("/api/agents/bridge")
        assert answer.status == 200
        assert "agent_bridge" in str(answer.body) or "BLOB_BOT_TOKEN" in str(answer.body)


class TestThePolicyStillApplies:
    async def test_a_workspace_that_may_not_connect_socket_agents_refuses(self, team: dict) -> None:
        await allow_policy(team["workspace_id"], may_connect_socket_agents=False)

        refused = await team["marko"].post("/api/agents/mine", {"name": "Desktop Claude"})

        assert refused.status == 403, refused.body
        assert refused.body["error"]["code"] == "policy_forbidden"

    async def test_the_app_limit_counts_personal_agents(self, team: dict) -> None:
        await allow_policy(team["workspace_id"])
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE workspace_policies SET max_apps = 1 WHERE workspace_id = :ws"),
                    {"ws": team["workspace_id"]},
                )
        await attach(team["marko"], "First")

        refused = await team["ana"].post("/api/agents/mine", {"name": "Second"})

        assert refused.status == 403, refused.body


class TestWhoseItIs:
    async def test_mine_lists_only_mine(self, team: dict) -> None:
        await attach(team["marko"], "Marko's")
        await attach(team["ana"], "Ana's")

        mine = (await team["marko"].get("/api/agents/mine")).body["agents"]

        assert [a["name"] for a in mine] == ["Marko's"]

    async def test_somebody_elses_agent_answers_404_not_403(self, team: dict) -> None:
        attached = await attach(team["marko"])
        agent_id = attached["agent"]["id"]

        assert (await team["ana"].delete(f"/api/agents/mine/{agent_id}")).status == 404
        assert (await team["ana"].get(f"/api/agents/mine/{agent_id}/channels")).status == 404
        assert (
            await team["ana"].post(f"/api/agents/mine/{agent_id}/channels/{team['general']}")
        ).status == 404
        # Still there, untouched.
        assert (await plugin_row(agent_id))["status"] == "enabled"

    async def test_an_admin_installed_agent_is_not_mine(self, team: dict) -> None:
        # Unowned agents are the workspace's; they do not show up as anyone's.
        installed = await team["owner"].post(
            "/api/admin/plugins",
            {
                "slug": "shared",
                "name": "Shared",
                "runtime": "socket",
                "version": "1.0.0",
                "events": [],
                "scopes": ["messages:read", "messages:write"],
            },
        )
        assert installed.status == 201, installed.body

        assert (await team["owner"].get("/api/agents/mine")).body["agents"] == []

    async def test_removing_mine_retires_it(self, team: dict) -> None:
        attached = await attach(team["marko"])
        agent_id = attached["agent"]["id"]

        gone = await team["marko"].delete(f"/api/agents/mine/{agent_id}")

        assert gone.status == 200, gone.body
        assert (await team["marko"].get("/api/agents/mine")).body["agents"] == []
        async with SessionFactory() as session:
            left = (
                await session.execute(
                    text("SELECT count(*) FROM plugins WHERE id = :id"), {"id": agent_id}
                )
            ).scalar_one()
        assert left == 0


class TestWhereItGoes:
    async def test_only_my_channels_are_offered(self, team: dict) -> None:
        made = await team["owner"].post("/api/channels", {"name": "owners-only", "kind": "private"})
        assert made.status == 200, made.body
        attached = await attach(team["marko"])

        offered = (
            await team["marko"].get(f"/api/agents/mine/{attached['agent']['id']}/channels")
        ).body

        names = [c["name"] for c in offered["channels"]]
        assert "general" in names
        assert "owners-only" not in names
        assert all(c["joined"] is False for c in offered["channels"])

    async def test_i_can_add_it_to_a_channel_i_am_in(self, team: dict) -> None:
        attached = await attach(team["marko"])
        agent_id = attached["agent"]["id"]

        added = await team["marko"].post(f"/api/agents/mine/{agent_id}/channels/{team['general']}")

        assert added.status == 200, added.body
        offered = (await team["marko"].get(f"/api/agents/mine/{agent_id}/channels")).body
        general = next(c for c in offered["channels"] if c["id"] == team["general"])
        assert general["joined"] is True

        removed = await team["marko"].delete(
            f"/api/agents/mine/{agent_id}/channels/{team['general']}"
        )
        assert removed.status == 200, removed.body

    async def test_but_not_to_one_i_am_not_in(self, team: dict) -> None:
        made = await team["owner"].post("/api/channels", {"name": "owners-only", "kind": "private"})
        private_id = made.body["channel"]["id"]
        attached = await attach(team["marko"])

        refused = await team["marko"].post(
            f"/api/agents/mine/{attached['agent']['id']}/channels/{private_id}"
        )

        # 404, because the channel's existence is the private part.
        assert refused.status == 404, refused.body
