"""An agent uses a connected server's tools, through Blob (ADR 0027).

The tools are offered beside Blob's own as `<server>__<tool>`: only to an agent an admin
granted the server, only while the server is on and the tool is not off, and never to a
run nobody addressed. A call runs with the server's credential at once when its policy
says so, and otherwise waits for the Approve of the person who asked — who sees what would
be sent before anything leaves Blob. The card names the server a call went to; a server
that cannot answer is an error the agent reads and a line on the server's row.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.plugins import mcp_client

from .mcp_fake import URL, FakeMcpServer
from .test_agent_tools import (
    allow,
    ask,
    calls,
    press,
    requests,
    resume_after,
    says,
    team_fixture,  # noqa: F401 — the `team` fixture: a fake agent in #general
    the_run,
    tool_results,
)
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module


@pytest.fixture(autouse=True)
def _no_sessions_between_tests() -> None:
    mcp_client.reset_for_tests()


async def connect(
    team: dict[str, Any], monkeypatch: pytest.MonkeyPatch, *, grant: bool = True
) -> tuple[FakeMcpServer, dict[str, Any]]:
    fake = FakeMcpServer(token="t").install(monkeypatch)
    created = await team["owner"].post(
        "/api/admin/mcp-servers",
        {"name": "GitHub", "url": URL, "auth": {"kind": "bearer", "value": "t"}},
    )
    assert created.status == 201, created.body
    if grant:
        granted = await team["owner"].put(
            f"/api/admin/mcp-servers/{created.body['id']}/agents/{team['plugin_id']}"
        )
        assert granted.status == 200, granted.body
    fake.requests.clear()
    fake.bodies.clear()
    return fake, dict(created.body)


async def policy(team: dict[str, Any], server: dict[str, Any], tool: str, value: str) -> None:
    set_ = await team["owner"].put(
        f"/api/admin/mcp-servers/{server['id']}/tools", {"name": tool, "policy": value}
    )
    assert set_.status == 200, set_.body


def offered(team: dict[str, Any], index: int = 0) -> dict[str, dict[str, Any]]:
    return {tool["name"]: tool for tool in requests(team)[index]["tools"]}


ISSUE = {"repo": "blob/app", "title": "Login fails on Safari"}


class TestOffering:
    async def test_a_granted_servers_tools_are_offered_beside_blobs_own(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        await allow(team, "read")
        await connect(team, monkeypatch)
        await ask(team, "@Helper hi", says("Hi."))

        tools = offered(team)
        assert "read_channel" in tools  # Blob's own, unchanged
        assert {"github__search_issues", "github__create_issue"} <= set(tools)
        create = tools["github__create_issue"]
        assert create["description"].startswith("Open a new issue.")
        assert "A tool on GitHub, outside Blob" in create["description"]
        assert "waits for the person" in create["description"]
        # The header mark is the transport's business, not the model's.
        assert "x-mcp-header" not in json.dumps(create["parameters"])
        assert create["parameters"]["required"] == ["repo", "title"]
        assert "waits" not in tools["github__search_issues"]["description"]

    async def test_only_with_a_grant_a_server_switched_on_and_a_tool_not_off(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _, server = await connect(team, monkeypatch, grant=False)
        await ask(team, "@Helper hi", says("Hi."))
        assert offered(team) == {}

        await team["owner"].put(f"/api/admin/mcp-servers/{server['id']}/agents/{team['plugin_id']}")
        await team["owner"].patch(f"/api/admin/mcp-servers/{server['id']}", {"enabled": False})
        team["state"]["seen"] = []
        await ask(team, "@Helper hi", says("Hi."))
        assert offered(team) == {}

        await team["owner"].patch(f"/api/admin/mcp-servers/{server['id']}", {"enabled": True})
        await policy(team, server, "create_issue", "off")
        team["state"]["seen"] = []
        await ask(team, "@Helper hi", says("Hi."))
        assert set(offered(team)) == {"github__search_issues"}

    async def test_a_run_nobody_addressed_is_offered_none(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        await connect(team, monkeypatch)
        followed = await team["owner"].put(
            f"/api/admin/plugins/{team['plugin_id']}/follows/{team['general']}"
        )
        assert followed.status == 200, followed.body
        await ask(team, "the build is red again", says("I can look."))
        assert (await the_run(team))["status"] == "succeeded"
        assert not any("__" in name for name in offered(team))


class TestCalling:
    async def test_a_read_only_tool_runs_at_once_and_the_agent_hears_its_answer(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, _ = await connect(team, monkeypatch)
        await ask(
            team,
            "@Helper find the login bug",
            calls(("c1", "github__search_issues", {"query": "login"})),
            says("It is issue 12."),
        )

        assert fake.calls == [("search_issues", {"query": "login"})]
        assert all(r.headers["authorization"] == "Bearer t" for r in fake.requests)
        [result] = tool_results(requests(team)[1])
        assert result["toolCallId"] == "c1"
        assert result["content"].startswith("search_issues ran with")
        run = await the_run(team)
        assert run["status"] == "succeeded"
        [drawn] = run["card"]["tools"]
        assert drawn["name"] == "github__search_issues" and drawn["via"] == "GitHub"
        # What it was shown names the server, not every tool on it.
        async with SessionFactory() as session:
            seen = (
                await session.execute(
                    text("SELECT seen FROM agent_runs WHERE id = :id"), {"id": run["id"]}
                )
            ).scalar_one()
        assert seen["servers"] == ["GitHub"]
        assert not any("__" in name for name in seen["tools"])

    async def test_a_tool_that_asks_shows_the_person_what_would_be_sent(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, _ = await connect(team, monkeypatch)
        await ask(
            team,
            "@Helper open an issue for the login bug",
            calls(("c1", "github__create_issue", ISSUE)),
        )
        run = await the_run(team)
        assert run["status"] == "interrupted"
        assert run["interrupt"]["kind"] == "tool_approval"
        [item] = run["interrupt"]["items"]
        assert "Helper wants to use “Create issue” on GitHub, outside Blob" in item["message"]
        # One argument to an item, so the channel's markdown keeps one to a line.
        assert "\n- repo: blob/app\n- title: Login fails on Safari" in item["message"]
        assert fake.calls == []  # nothing has left Blob

        assert (await press(team, team["owner"], run, 0)).status == 200  # Approve
        await resume_after(team, run, says("Opened it."))

        assert fake.calls == [("create_issue", ISSUE)]
        assert fake.requests[-1].headers["mcp-param-repo"] == "blob/app"
        [result] = tool_results(requests(team)[0])
        assert result["toolCallId"] == "c1"
        assert result["content"].startswith("create_issue ran with")

    async def test_a_declined_call_is_never_made(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, _ = await connect(team, monkeypatch)
        await ask(team, "@Helper open an issue", calls(("c1", "github__create_issue", ISSUE)))
        run = await the_run(team)
        assert (await press(team, team["owner"], run, 1)).status == 200  # Deny
        await resume_after(team, run, says("Understood."))

        assert fake.calls == []
        [result] = tool_results(requests(team)[0])
        assert "declined: it was not run" in result["content"]

    async def test_a_tool_switched_off_while_the_question_waits_is_not_called(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, server = await connect(team, monkeypatch)
        await ask(team, "@Helper open an issue", calls(("c1", "github__create_issue", ISSUE)))
        run = await the_run(team)
        await policy(team, server, "create_issue", "off")

        assert (await press(team, team["owner"], run, 0)).status == 200
        await resume_after(team, run, says("Never mind."))

        assert fake.calls == []
        [result] = tool_results(requests(team)[0])
        assert "no longer one you may use" in result["content"]

    async def test_in_dm_only_runs_in_its_dm_and_asks_in_a_channel(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, server = await connect(team, monkeypatch)
        await policy(team, server, "create_issue", "auto_in_dm")

        await ask(team, "@Helper open an issue", calls(("c1", "github__create_issue", ISSUE)))
        assert (await the_run(team))["status"] == "interrupted"
        assert fake.calls == []

        bot_id = team["app"]["plugin"]["botUserId"]
        dm = await team["owner"].post("/api/dms", {"userIds": [bot_id]})
        assert dm.status in (200, 201), dm.body
        await ask(
            team,
            "@Helper open an issue",
            calls(("c2", "github__create_issue", ISSUE)),
            says("Opened."),
            where=dm.body["channel"]["id"],
        )
        assert fake.calls == [("create_issue", ISSUE)]
        assert (await the_run(team))["status"] == "succeeded"

    async def test_a_server_that_cannot_answer_is_an_error_the_agent_reads(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake, server = await connect(team, monkeypatch)
        fake.fail_with = 503
        await ask(
            team,
            "@Helper find the login bug",
            calls(("c1", "github__search_issues", {"query": "login"})),
            says("GitHub is down."),
        )
        [result] = tool_results(requests(team)[1])
        assert result["content"].startswith("Error: GitHub: The server answered 503")
        async with SessionFactory() as session:
            noted = (
                await session.execute(
                    text("SELECT last_error FROM mcp_servers WHERE id = :id"), {"id": server["id"]}
                )
            ).scalar_one()
        assert "503" in noted
