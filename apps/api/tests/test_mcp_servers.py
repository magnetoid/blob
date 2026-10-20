"""The MCP servers page: connecting a server, its tools' policies, who may use it (ADR 0027).

A server is listed before it is kept, so one that cannot answer is never added and the
admin is told why. Its credential goes in and never comes back out. Its tools start where
the server says — a read-only one runs without asking, anything else asks — and keep the
admin's choice across a refresh. Only an agent may be granted one.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.plugins import mcp_client
from blob_api.services import mcp_servers

from .helpers import Client, invite_and_sign_up, sign_up
from .mcp_fake import HOST, URL, FakeMcpServer, a_tool
from .test_agui import install


@pytest.fixture(autouse=True)
def _public_example_host(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == HOST else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)
    mcp_client.reset_for_tests()
    yield
    mcp_client.reset_for_tests()


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    return {"owner": owner, "member": member}


async def connect(owner: Client, name: str = "GitHub", **auth: Any) -> dict[str, Any]:
    response = await owner.post(
        "/api/admin/mcp-servers", {"name": name, "url": URL, "auth": auth or {"kind": "none"}}
    )
    assert response.status == 201, response.body
    return dict(response.body)


def tool(server: dict[str, Any], name: str) -> dict[str, Any]:
    return next(t for t in server["tools"] if t["name"] == name)


async def stored_secret() -> list[tuple[str, str]]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(text("SELECT header_name, header_value FROM mcp_server_secrets"))
        ).fetchall()
    return [(row.header_name, row.header_value) for row in rows]


class TestConnecting:
    async def test_an_admin_connects_a_server_and_its_tools_start_where_it_says(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer(token="ghp_secret").install(monkeypatch)
        server = await connect(team["owner"], kind="bearer", value="ghp_secret")

        assert server["name"] == "GitHub" and server["slug"] == "github"
        assert (server["era"], server["protocolVersion"]) == ("modern", "2026-07-28")
        assert server["serverName"] == "fake"
        assert server["auth"] == "bearer" and server["authHeader"] is None
        # Read-only by the server's word: runs without asking. Anything else asks.
        assert tool(server, "search_issues")["policy"] == "auto_everywhere"
        assert tool(server, "create_issue")["policy"] == "ask"
        assert server["agentIds"] == []
        assert fake.requests[0].headers["authorization"] == "Bearer ghp_secret"

        listed = await team["owner"].get("/api/admin/mcp-servers")
        assert [s["id"] for s in listed.body["servers"]] == [server["id"]]
        # The credential goes in and never comes back out.
        assert "ghp_secret" not in json.dumps(server)
        assert "ghp_secret" not in json.dumps(listed.body)
        assert await stored_secret() == [("Authorization", "Bearer ghp_secret")]

    async def test_a_pasted_bearer_prefix_is_not_doubled(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer(token="t0k").install(monkeypatch)
        await connect(team["owner"], kind="bearer", value="Bearer t0k")
        assert await stored_secret() == [("Authorization", "Bearer t0k")]

    async def test_a_named_header_carries_the_secret(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"], kind="header", header="X-Api-Key", value="k-1")
        assert server["auth"] == "header" and server["authHeader"] == "X-Api-Key"
        assert fake.requests[0].headers["x-api-key"] == "k-1"

    async def test_a_header_blob_sets_itself_cannot_be_the_secret(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        for header in ("Mcp-Method", "Content-Type", "Mcp-Param-Repo", "not a header"):
            refused = await team["owner"].post(
                "/api/admin/mcp-servers",
                {
                    "name": "X",
                    "url": URL,
                    "auth": {"kind": "header", "header": header, "value": "v"},
                },
            )
            assert refused.status == 400, header
            assert refused.body["error"]["code"] == "invalid_input"
        assert fake.requests == []

    async def test_a_token_a_header_cannot_carry_is_refused_in_words(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Found in review: a non-breaking space pasted with a token failed inside the HTTP
        library as an error nobody had written a message for — a 500."""
        fake = FakeMcpServer().install(monkeypatch)
        for value in ("tok\u00a0en", "“token”", "line\nbreak"):
            refused = await team["owner"].post(
                "/api/admin/mcp-servers",
                {"name": "X", "url": URL, "auth": {"kind": "bearer", "value": value}},
            )
            assert refused.status == 400, value
            assert refused.body["error"]["code"] == "invalid_input"
        assert fake.requests == []

    async def test_a_server_that_cannot_answer_is_not_added(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        fake.fail_with = 500
        refused = await team["owner"].post("/api/admin/mcp-servers", {"name": "Down", "url": URL})
        assert refused.status == 400
        assert refused.body["error"]["code"] == "mcp_unreachable"
        assert "500" in refused.body["error"]["message"]
        assert (await team["owner"].get("/api/admin/mcp-servers")).body["servers"] == []

    async def test_an_address_inside_the_network_is_refused_unasked(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        for url in ("https://10.0.0.5/mcp", "https://127.0.0.1/mcp", f"http://{HOST}/mcp"):
            refused = await team["owner"].post("/api/admin/mcp-servers", {"name": "X", "url": url})
            assert refused.status == 400, url
            assert refused.body["error"]["code"] == "bad_mcp_url"
        assert fake.requests == []

    async def test_names_are_unique_whatever_the_case(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        await connect(team["owner"], "GitHub")
        again = await team["owner"].post("/api/admin/mcp-servers", {"name": "github", "url": URL})
        assert again.status == 409
        assert again.body["error"]["code"] == "mcp_server_exists"

    async def test_a_workspace_connects_only_so_many(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        monkeypatch.setattr(mcp_servers, "MAX_SERVERS", 1)
        await connect(team["owner"], "One")
        refused = await team["owner"].post("/api/admin/mcp-servers", {"name": "Two", "url": URL})
        assert refused.status == 400
        assert refused.body["error"]["code"] == "mcp_server_limit"

    async def test_only_an_admin_may(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        assert (await team["member"].get("/api/admin/mcp-servers")).status == 403
        refused = await team["member"].post("/api/admin/mcp-servers", {"name": "X", "url": URL})
        assert refused.status == 403

    async def test_slugs_stay_unique_and_tool_safe(self) -> None:
        assert mcp_servers.slug_for("GitHub", set()) == "github"
        assert mcp_servers.slug_for("GitHub", {"github"}) == "github-2"
        assert mcp_servers.slug_for("42 Docs!", set()) == "mcp-42-docs"
        assert mcp_servers.slug_for("Linear_App", set()) == "linear-app"  # never an underscore
        assert mcp_servers.offered_name("github", "repos.list", set()) == "github__repos_list"
        long = mcp_servers.offered_name("github", "x" * 80, set())
        assert len(long) == 64


class TestChanging:
    async def test_a_refresh_keeps_the_admins_policies_and_takes_what_changed(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        off = await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/tools",
            {"name": "create_issue", "policy": "off"},
        )
        assert off.status == 200 and tool(off.body, "create_issue")["policy"] == "off"

        fake.tools = [fake.tools[1], a_tool("list_repos", annotations={"readOnlyHint": True})]
        fresh = await team["owner"].post(f"/api/admin/mcp-servers/{server['id']}/refresh")
        assert fresh.status == 200, fresh.body
        assert [t["name"] for t in fresh.body["tools"]] == ["create_issue", "list_repos"]
        assert tool(fresh.body, "create_issue")["policy"] == "off"  # the admin's, kept
        assert tool(fresh.body, "list_repos")["policy"] == "auto_everywhere"

    async def test_a_failed_refresh_keeps_the_tools_and_says_why(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        fake.fail_with = 502
        refused = await team["owner"].post(f"/api/admin/mcp-servers/{server['id']}/refresh")
        assert refused.status == 400 and refused.body["error"]["code"] == "mcp_unreachable"
        [kept] = (await team["owner"].get("/api/admin/mcp-servers")).body["servers"]
        assert len(kept["tools"]) == 2
        assert "502" in kept["lastError"] and kept["lastErrorAt"]

    async def test_a_new_address_is_listed_again_and_keeps_the_credential(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer(token="k").install(monkeypatch)
        server = await connect(team["owner"], kind="bearer", value="k")
        fake.requests.clear()
        moved = await team["owner"].patch(
            f"/api/admin/mcp-servers/{server['id']}", {"url": f"https://{HOST}/v2/mcp"}
        )
        assert moved.status == 200, moved.body
        assert moved.body["url"] == f"https://{HOST}/v2/mcp"
        assert fake.requests and all(r.url.path == "/v2/mcp" for r in fake.requests)
        assert all(r.headers["authorization"] == "Bearer k" for r in fake.requests)

    async def test_switched_off_and_renamed_without_asking_the_server(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        fake.requests.clear()
        changed = await team["owner"].patch(
            f"/api/admin/mcp-servers/{server['id']}", {"enabled": False, "name": "Code"}
        )
        assert changed.status == 200
        assert changed.body["enabled"] is False and changed.body["name"] == "Code"
        assert changed.body["slug"] == "github"  # a slug never changes: agents' names hold
        assert fake.requests == []

    async def test_an_unknown_policy_or_tool_is_refused(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        url = f"/api/admin/mcp-servers/{server['id']}/tools"
        bad = await team["owner"].put(url, {"name": "create_issue", "policy": "sometimes"})
        assert bad.status == 400
        missing = await team["owner"].put(url, {"name": "nope", "policy": "off"})
        assert missing.status == 404


class TestWhoMayUseIt:
    async def test_an_agent_is_granted_a_server_and_a_webhook_app_is_not(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        agent = await install(team["owner"])
        hooks = await install(
            team["owner"],
            slug="hooks",
            name="Hooks",
            aguiUrl=None,
            requestUrl="https://apps.example.com/hooks",
            events=["message.created"],
        )
        granted = await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/agents/{agent['plugin']['id']}"
        )
        assert granted.status == 200 and granted.body["agentIds"] == [agent["plugin"]["id"]]

        refused = await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/agents/{hooks['plugin']['id']}"
        )
        assert refused.status == 400 and refused.body["error"]["code"] == "not_an_agent"

        revoked = await team["owner"].delete(
            f"/api/admin/mcp-servers/{server['id']}/agents/{agent['plugin']['id']}"
        )
        assert revoked.status == 200 and revoked.body["agentIds"] == []

    async def test_removing_a_server_takes_its_grants_and_its_credential(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer(token="k").install(monkeypatch)
        server = await connect(team["owner"], kind="bearer", value="k")
        agent = await install(team["owner"])
        await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/agents/{agent['plugin']['id']}"
        )
        gone = await team["owner"].delete(f"/api/admin/mcp-servers/{server['id']}")
        assert gone.status == 200
        assert (await team["owner"].get("/api/admin/mcp-servers")).body["servers"] == []
        async with SessionFactory() as session:
            for table in ("agent_mcp_servers", "mcp_server_secrets", "mcp_server_tools"):
                left = (await session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
                assert left == 0, table

    async def test_what_an_admin_did_is_in_the_audit_log(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        server = await connect(team["owner"])
        agent = await install(team["owner"])
        await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/tools",
            {"name": "create_issue", "policy": "off"},
        )
        await team["owner"].put(
            f"/api/admin/mcp-servers/{server['id']}/agents/{agent['plugin']['id']}"
        )
        await team["owner"].delete(f"/api/admin/mcp-servers/{server['id']}")
        async with SessionFactory() as session:
            actions = [
                row.action
                for row in (
                    await session.execute(
                        text(
                            "SELECT action FROM audit_events WHERE action LIKE 'mcp_server.%' "
                            "ORDER BY created_at"
                        )
                    )
                ).fetchall()
            ]
        assert actions == [
            "mcp_server.added",
            "mcp_server.tool_policy",
            "mcp_server.granted",
            "mcp_server.removed",
        ]
