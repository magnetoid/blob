"""Configuring a hosted agent from the console, without manufacturing the duplicate bug.

The runner's environment API does not upsert. Probing the live one: `POST` appends, and
`PATCH` with a key that already exists **also** appends — it answers 201 and creates a
second row. `PATCH /envs/{env_uuid}` does not exist. `PATCH /envs/bulk` does update in
place, but touches only one of the rows sharing a key and leaves the rest.

That is not a hypothetical. A live agent was carrying twelve duplicated keys, and the two
that disagreed were an API key set in one row and empty in the other. Docker takes one of
them and nothing says which, so every run failed to authenticate against a key the
dashboard displayed as correct.

So a write here removes every row for the key and creates one. The tests that matter are
the ones that start from a runner *already* holding duplicates, because repairing them is
the property — a console that only avoided adding new ones would leave every existing
agent broken.
"""

from __future__ import annotations

from typing import Any

import pytest

from blob_api.lib import net
from blob_api.plugins import runner as runner_module
from blob_api.plugins.manifest import Manifest
from blob_api.plugins.runner import Deployment, EnvVar
from blob_api.plugins.source import RepoSource

from .helpers import Client, allow_policy, sign_up, workspace_id_of

REPO = "https://github.com/magnetoid/standup-agent"

MANIFEST: dict[str, Any] = {
    "slug": "standup-agent",
    "name": "Standup Agent",
    "version": "1.0.0",
    "aguiPath": "/agui",
    "scopes": ["messages:read", "messages:write"],
}


class Runner:
    """An environment store with the runner's actual semantics: append, never upsert."""

    def __init__(self) -> None:
        self.rows: list[EnvVar] = []
        self.deleted: list[str] = []
        self._next = 0

    def add(self, key: str, value: str, *, managed: bool = False) -> EnvVar:
        self._next += 1
        row = EnvVar(id=f"env-{self._next}", key=key, value=value, managed=managed)
        self.rows.append(row)
        return row

    async def deploy(
        self,
        *,
        slug: str,
        repo: str,
        ref: str,
        env: dict[str, str],
        port: int = 3000,
        compose_path: str | None = None,
    ) -> Deployment:
        for key, value in env.items():
            self.add(key, value)
        return Deployment(id="dep-1", status="deploying")

    async def redeploy(self, deployment_id: str) -> Deployment:
        return Deployment(id=deployment_id, status="deploying")

    async def status(self, deployment_id: str) -> Deployment:
        return Deployment(id=deployment_id, status="running", url="agent.example.com")

    async def logs(self, deployment_id: str, lines: int = 200) -> str:
        return ""

    async def stop(self, deployment_id: str) -> None:
        return None

    async def env(self, deployment_id: str) -> list[EnvVar]:
        return list(self.rows)

    async def set_env(self, deployment_id: str, key: str, value: str) -> None:
        for row in [r for r in self.rows if r.key == key]:
            self.rows.remove(row)
            self.deleted.append(row.id)
        self.add(key, value)

    async def unset_env(self, deployment_id: str, key: str) -> None:
        for row in [r for r in self.rows if r.key == key]:
            self.rows.remove(row)
            self.deleted.append(row.id)

    def values_of(self, key: str) -> list[str]:
        return [r.value for r in self.rows if r.key == key]


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname.endswith("example.com") else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest.fixture
def hosted(monkeypatch: pytest.MonkeyPatch) -> Runner:
    stub = Runner()
    monkeypatch.setattr(runner_module, "current_runner", lambda: stub)
    monkeypatch.setattr("blob_api.services.agents.current_runner", lambda: stub)

    async def fake_read(repo_url: str, ref: str = "main") -> RepoSource:
        return RepoSource(
            repo_url=repo_url,
            ref=ref,
            manifest=Manifest.model_validate({**MANIFEST, "runtime": "container"}),
            build_pack="nixpacks",
        )

    monkeypatch.setattr("blob_api.services.agents.read_manifest", fake_read)
    monkeypatch.setattr("blob_api.services.agents.ADDRESS_POLL_SEC", 0.0)
    return stub


async def install(client: Client) -> tuple[Client, str]:
    owner = await sign_up(client, "Owner")
    await allow_policy(await workspace_id_of(owner))
    response = await owner.post(
        "/api/admin/plugins/from-repo",
        {"repoUrl": REPO, "ref": "main", "env": {"OPENROUTER_API_KEY": "first-value"}},
    )
    assert response.status == 201, response.body
    return owner, str(response.body["plugin"]["id"])


class TestWriting:
    async def test_setting_a_key_twice_leaves_one_row(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)

        for value in ("second", "third"):
            response = await owner.put(
                f"/api/admin/plugins/{plugin_id}/env", {"set": {"OPENROUTER_API_KEY": value}}
            )
            assert response.status == 200, response.body

        assert hosted.values_of("OPENROUTER_API_KEY") == ["third"]

    async def test_it_repairs_duplicates_that_were_already_there(
        self, hosted: Runner, client: Client
    ) -> None:
        owner, plugin_id = await install(client)
        # The live shape exactly: two rows for one key, disagreeing, one of them empty.
        hosted.add("ANTHROPIC_API_KEY", "sk-the-real-one")
        hosted.add("ANTHROPIC_API_KEY", "")

        await owner.put(
            f"/api/admin/plugins/{plugin_id}/env", {"set": {"ANTHROPIC_API_KEY": "sk-fixed"}}
        )

        # The repair arrives by using the feature, which is the point: no migration to
        # run, and an operator who fixes the value fixes the duplication with it.
        assert hosted.values_of("ANTHROPIC_API_KEY") == ["sk-fixed"]

    async def test_removing_a_key_removes_every_row_of_it(
        self, hosted: Runner, client: Client
    ) -> None:
        owner, plugin_id = await install(client)
        hosted.add("STALE", "a")
        hosted.add("STALE", "b")

        await owner.put(f"/api/admin/plugins/{plugin_id}/env", {"remove": ["STALE"]})

        assert hosted.values_of("STALE") == []

    async def test_saving_can_restart_the_agent(
        self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner, plugin_id = await install(client)
        redeployed: list[str] = []
        original = hosted.redeploy

        async def watch(deployment_id: str) -> Deployment:
            redeployed.append(deployment_id)
            return await original(deployment_id)

        monkeypatch.setattr(hosted, "redeploy", watch)

        await owner.put(
            f"/api/admin/plugins/{plugin_id}/env",
            {"set": {"MODEL": "gpt-5-codex"}, "restart": True},
        )

        # Environment only reaches a container on the next start, so without this the
        # console would be showing a value the running agent does not have.
        assert redeployed == ["dep-1"]

    async def test_it_does_not_restart_unless_asked(
        self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner, plugin_id = await install(client)
        redeployed: list[str] = []
        monkeypatch.setattr(
            hosted, "redeploy", lambda d: redeployed.append(d) or Deployment(id=d, status="x")
        )

        await owner.put(f"/api/admin/plugins/{plugin_id}/env", {"set": {"MODEL": "a"}})

        # Someone setting three values wants one restart at the end, not three.
        assert redeployed == []


class TestWhatIsShown:
    async def test_a_secret_is_described_rather_than_printed(
        self, hosted: Runner, client: Client
    ) -> None:
        owner, plugin_id = await install(client)

        body = (await owner.get(f"/api/admin/plugins/{plugin_id}/env")).body
        [key] = [e for e in body["env"] if e["key"] == "OPENROUTER_API_KEY"]

        assert key["secret"] is True
        assert key["value"] is None
        # Enough to tell "the key I pasted" from "the key that is still empty", which is
        # the question anyone opening this screen is actually asking.
        assert key["hint"] == "11 characters, ending alue"

    async def test_an_ordinary_value_is_shown(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)
        await owner.put(f"/api/admin/plugins/{plugin_id}/env", {"set": {"MODEL": "sonnet"}})

        body = (await owner.get(f"/api/admin/plugins/{plugin_id}/env")).body
        [model] = [e for e in body["env"] if e["key"] == "MODEL"]

        assert model["secret"] is False
        assert model["value"] == "sonnet"

    async def test_a_duplicated_key_is_flagged(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)
        hosted.add("MUDDLE", "a")
        hosted.add("MUDDLE", "b")

        body = (await owner.get(f"/api/admin/plugins/{plugin_id}/env")).body

        # Shown rather than quietly deduplicated: a key listed twice with two values is
        # the explanation for an agent ignoring the value the console is displaying.
        assert all(e["duplicated"] for e in body["env"] if e["key"] == "MUDDLE")

    async def test_the_runners_own_values_are_marked_managed(
        self, hosted: Runner, client: Client
    ) -> None:
        owner, plugin_id = await install(client)
        hosted.add("SERVICE_FQDN_APP", "app.example.com", managed=True)

        body = (await owner.get(f"/api/admin/plugins/{plugin_id}/env")).body
        [service] = [e for e in body["env"] if e["key"] == "SERVICE_FQDN_APP"]

        # The runner rewrites these on every deploy, so an edit is lost without failing.
        assert service["managed"] is True


class TestWhatBlobKeepsForItself:
    async def test_a_reserved_key_cannot_be_set(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)

        response = await owner.put(
            f"/api/admin/plugins/{plugin_id}/env", {"set": {"BLOB_BOT_TOKEN": "mine-now"}}
        )

        assert response.status == 400
        assert response.body["error"]["code"] == "reserved_env_key"

    async def test_a_reserved_key_cannot_be_removed(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)

        response = await owner.put(
            f"/api/admin/plugins/{plugin_id}/env", {"remove": ["BLOB_SIGNING_SECRET"]}
        )

        # Deleting this turns a working agent into one that fails every callback with no
        # explanation, so it is refused on the way out as well as the way in.
        assert response.status == 400
        assert response.body["error"]["code"] == "reserved_env_key"

    async def test_the_port_is_reserved_too(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)

        response = await owner.put(f"/api/admin/plugins/{plugin_id}/env", {"set": {"PORT": "99"}})

        # Not prefixed, and easy to miss for that reason. An agent that binds a port the
        # proxy was not told about is unreachable, which presents as one that crashed.
        assert response.status == 400
        assert response.body["error"]["code"] == "reserved_env_key"

    async def test_the_port_cannot_be_removed_either(
        self, hosted: Runner, client: Client
    ) -> None:
        owner, plugin_id = await install(client)

        response = await owner.put(
            f"/api/admin/plugins/{plugin_id}/env", {"remove": ["PORT"], "restart": True}
        )

        # The removal check tested only the BLOB_ prefix and never the by-name list, so
        # the one reserved name that is not prefixed could be deleted and the agent
        # redeployed against it — binding whatever default its code picks while the proxy
        # still routes to the old port. Setting it has always been refused; the two rules
        # are now one predicate.
        assert response.status == 400, response.body
        assert response.body["error"]["code"] == "reserved_env_key"

    async def test_the_reserved_names_are_listed(self, hosted: Runner, client: Client) -> None:
        owner, plugin_id = await install(client)

        body = (await owner.get(f"/api/admin/plugins/{plugin_id}/env")).body

        # So the console can show them as fixed. A name missing from a form with no
        # explanation reads as the form having lost it.
        assert "BLOB_BOT_TOKEN" in body["reserved"]
        assert "PORT" in body["reserved"]


class TestAuthorization:
    async def test_a_member_cannot_read_configuration(self, hosted: Runner, client: Client) -> None:
        from .helpers import invite_and_sign_up

        owner, plugin_id = await install(client)
        member = await invite_and_sign_up(owner, "Member")

        assert (await member.get(f"/api/admin/plugins/{plugin_id}/env")).status == 403

    async def test_a_member_cannot_write_it(self, hosted: Runner, client: Client) -> None:
        from .helpers import invite_and_sign_up

        owner, plugin_id = await install(client)
        member = await invite_and_sign_up(owner, "Member")

        response = await member.put(f"/api/admin/plugins/{plugin_id}/env", {"set": {"MODEL": "x"}})
        assert response.status == 403
