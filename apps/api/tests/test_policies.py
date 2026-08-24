"""What a workspace may do to the machine it runs on.

Every app endpoint authorises a *workspace* admin, which was the whole story while one
workspace was the server. Multi-workspace split the workspace admin from the person who
owns the hardware and left every capability with the former. These are the guards that
give the operator a say.

Two rules carry it and both are easy to get wrong:

* **The environment is the ceiling.** A policy row narrows what the server permits and
  can never widen it, so an operator who turned hosting off globally cannot be surprised
  by a row turning it back on.
* **Only an instance admin writes policy.** A workspace admin who could edit their own
  limits does not have limits. There is deliberately no workspace-admin route to this
  table, which is why it is not in `workspace_settings`.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.services import policies as policy_service

from .helpers import Client, invite_and_sign_up, sign_up

APP = {
    "slug": "helper",
    "name": "Helper",
    "runtime": "external",
    "version": "1.0.0",
    "aguiUrl": "https://apps.example.com/agui",
    "events": [],
    "scopes": ["messages:read", "messages:write"],
}

SOCKET_AGENT = {
    "slug": "desktop",
    "name": "Desktop",
    "runtime": "socket",
    "version": "1.0.0",
    "events": [],
    "scopes": ["messages:read", "messages:write"],
}


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """`apps.example.com` is not a real host, so the SSRF guard would refuse every app."""
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    """The first signup: owner of the first workspace, and the server's instance admin."""
    return await sign_up(client, "Founder")


async def policy_of(founder: Client, workspace_id: str) -> dict:
    response = await founder.get(f"/api/admin/instance/workspaces/{workspace_id}/policy")
    assert response.status == 200, response.body
    return response.body


async def set_policy(founder: Client, workspace_id: str, **fields: object) -> dict:
    response = await founder.put(
        f"/api/admin/instance/workspaces/{workspace_id}/policy", fields
    )
    assert response.status == 200, response.body
    return response.body


async def my_workspace_id(client: Client) -> str:
    boot = (await client.get("/api/bootstrap")).body
    return str(boot["workspace"]["id"])


# ─── who may write it ─────────────────────────────────────────────────────────
class TestAuthority:
    async def test_a_workspace_admin_cannot_read_or_write_their_own_policy(
        self, founder: Client
    ) -> None:
        """The whole reason this is not a field in `workspace_settings`.

        A workspace admin who can edit their own limits does not have limits.
        """
        workspace_id = await my_workspace_id(founder)
        admin = await invite_and_sign_up(founder, "Admin", role="admin")

        assert (
            await admin.get(f"/api/admin/instance/workspaces/{workspace_id}/policy")
        ).status == 403
        assert (
            await admin.put(
                f"/api/admin/instance/workspaces/{workspace_id}/policy",
                {"mayHostAgents": True},
            )
        ).status == 403

    async def test_an_instance_admin_can(self, founder: Client) -> None:
        workspace_id = await my_workspace_id(founder)
        assert (await policy_of(founder, workspace_id))["workspaceId"] == workspace_id


# ─── defaults ─────────────────────────────────────────────────────────────────
class TestDefaults:
    async def test_a_workspace_with_no_row_reads_as_the_defaults(
        self, founder: Client
    ) -> None:
        """No row is a documented state, not a missing one.

        Migration 0013 seeds the workspaces that existed when it ran, so an upgrade does
        not revoke what a workspace had yesterday. Everything created afterwards — which
        is every workspace in this database — is on the defaults.
        """
        async with SessionFactory() as session:
            stored = await policy_service.stored_for(session, await my_workspace_id(founder))
        assert stored.may_host_agents is False
        assert stored.denied_scopes == frozenset()

    async def test_a_new_workspace_starts_closed_to_the_host(self, founder: Client) -> None:
        created = (
            await founder.post("/api/admin/instance/workspaces", {"name": "Second"})
        ).body

        policy = await policy_of(founder, created["id"])
        # No row means the column defaults, and the two capabilities that reach the
        # operator's machine start off. Socket agents reach nothing they were not
        # granted, so they start on.
        assert policy["mayHostAgents"] is False
        assert policy["mayUsePrivateEndpoints"] is False
        assert policy["mayConnectSocketAgents"] is True

    async def test_writing_one_field_leaves_the_others(self, founder: Client) -> None:
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, mayHostAgents=True)
        await set_policy(founder, workspace_id, maxApps=5)
        policy = await policy_of(founder, workspace_id)
        assert policy["maxApps"] == 5
        # Still set from the write before: a PUT of one switch must not clear the rest.
        assert policy["mayHostAgents"] is True


# ─── the ceiling ──────────────────────────────────────────────────────────────
class TestTheEnvironmentIsTheCeiling:
    async def test_policy_cannot_widen_what_the_server_forbids(
        self, founder: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AGENT_RUNNER unset means there is no runner to deploy through.

        A policy row saying otherwise must not make hosting possible, or an operator who
        turned it off globally could be surprised by a row they forgot about.
        """
        from blob_api.config import settings as app_settings

        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, mayHostAgents=True)
        monkeypatch.setattr(app_settings, "AGENT_RUNNER", "disabled")

        async with SessionFactory() as session:
            stored = await policy_service.stored_for(session, workspace_id)
            effective = await policy_service.effective_for(session, workspace_id)

        # Written down as allowed, and still refused.
        assert stored.may_host_agents is True
        assert effective.may_host_agents is False

    async def test_the_console_is_told_what_the_server_allows(self, founder: Client) -> None:
        # So it can say "off server-wide" rather than showing a tick that does nothing.
        policy = await policy_of(founder, await my_workspace_id(founder))
        assert "serverAllowsHosting" in policy
        assert "serverAllowsPrivateEndpoints" in policy


# ─── the guards ───────────────────────────────────────────────────────────────
class TestGuards:
    async def test_hosting_an_agent_is_refused_when_policy_says_no(
        self, founder: Client
    ) -> None:
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, mayHostAgents=False)

        response = await founder.post(
            "/api/admin/plugins/from-repo", {"repoUrl": "https://github.com/x/y", "ref": "main"}
        )
        assert response.status == 403
        assert response.body["error"]["code"] == "policy_forbidden"

    async def test_a_socket_agent_is_refused_when_policy_says_no(
        self, founder: Client
    ) -> None:
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, mayConnectSocketAgents=False)

        response = await founder.post("/api/admin/plugins", SOCKET_AGENT)
        assert response.status == 403
        assert response.body["error"]["code"] == "policy_forbidden"

    async def test_a_denied_scope_cannot_be_installed(self, founder: Client) -> None:
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, deniedScopes=["messages:write"])

        response = await founder.post("/api/admin/plugins", APP)
        assert response.status == 403
        assert response.body["error"]["code"] == "policy_forbidden"
        assert "messages:write" in response.body["error"]["message"]

    async def test_a_denied_scope_cannot_be_added_by_an_update(self, founder: Client) -> None:
        installed = (await founder.post("/api/admin/plugins", APP)).body
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, deniedScopes=["admin:write"])

        response = await founder.put(
            f"/api/admin/plugins/{installed['plugin']['id']}",
            {**APP, "scopes": [*APP["scopes"], "admin:write"]},
        )
        assert response.status == 403
        assert response.body["error"]["code"] == "policy_forbidden"

    async def test_the_app_limit_stops_the_next_install_and_not_an_edit(
        self, founder: Client
    ) -> None:
        installed = (await founder.post("/api/admin/plugins", APP)).body
        workspace_id = await my_workspace_id(founder)
        await set_policy(founder, workspace_id, maxApps=1)

        second = await founder.post(
            "/api/admin/plugins", {**APP, "slug": "other", "name": "Other"}
        )
        assert second.status == 403
        assert second.body["error"]["code"] == "policy_forbidden"

        # Editing the one that exists still works: a limit on how many apps you may have
        # should not strand the ones you have at whatever they were.
        edit = await founder.put(f"/api/admin/plugins/{installed['plugin']['id']}", APP)
        assert edit.status == 200, edit.body

    async def test_an_unknown_scope_is_refused_rather_than_stored(
        self, founder: Client
    ) -> None:
        workspace_id = await my_workspace_id(founder)
        response = await founder.put(
            f"/api/admin/instance/workspaces/{workspace_id}/policy",
            {"deniedScopes": ["messages:teleport"]},
        )
        # Otherwise a typo silently denies nothing and reads as a working restriction.
        assert response.status == 400
        assert response.body["error"]["code"] == "unknown_scope"


# ─── isolation ────────────────────────────────────────────────────────────────
async def test_one_workspace_s_policy_does_not_reach_another(founder: Client) -> None:
    first = await my_workspace_id(founder)
    created = (await founder.post("/api/admin/instance/workspaces", {"name": "Second"})).body

    await set_policy(founder, created["id"], deniedScopes=["messages:write"])

    # The first workspace is untouched, and can still install what the second cannot.
    assert (await policy_of(founder, first))["deniedScopes"] == []
    assert (await founder.post("/api/admin/plugins", APP)).status == 201
