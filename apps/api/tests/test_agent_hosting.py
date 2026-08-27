"""Making an agent Blob deployed actually reachable — and answerable.

Everything here guards a failure that was silent. A hosted agent installed cleanly,
reported `running`, and then ignored every mention of it: no reply, no error, no row in
the run log, nothing in a delivery queue. There was no symptom to search for, because
nothing had gone wrong in the sense of raising — the agent simply was not a listener, and
nothing in the system was ever going to make it one.

`jobs/agui.listeners_for` admits a plugin when `agui_url IS NOT NULL` or its runtime dials
in. `agui_url` came only from a manifest. A manifest is written before the agent has an
address, because the runner invents the hostname at deploy time. So the one field that
decides whether a deployed agent can be spoken to was the one field a deployed agent could
never fill in.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.lib.errors import AppError
from blob_api.plugins import runner as runner_module
from blob_api.plugins import source as source_module
from blob_api.plugins.manifest import Manifest
from blob_api.plugins.runner import Deployment
from blob_api.plugins.source import RepoSource

from .helpers import Client, allow_policy, sign_up, workspace_id_of

REPO = "https://github.com/magnetoid/janus"

#: Shaped like the real thing: an agent whose server is a compose file, listening on a
#: port that is not Blob's default, serving AG-UI at a path of its own.
MANIFEST: dict[str, Any] = {
    "slug": "janus",
    "name": "Janus",
    "version": "1.0.0",
    "aguiPath": "/v1/agui",
    "port": 8642,
    "scopes": ["messages:read", "messages:write"],
}


class Runner:
    """A runner that behaves like Coolify in the way that matters.

    Specifically: `deploy` answers *before* a hostname exists, and only `status` reports
    one. Every bug in this file lived in the gap between those two facts.
    """

    def __init__(self) -> None:
        self.deployed: dict[str, Any] | None = None
        self.status_calls = 0
        self.address: str | None = "janus.example.com"

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
        self.deployed = {
            "slug": slug,
            "env": dict(env),
            "port": port,
            "compose_path": compose_path,
        }
        return Deployment(id="dep-1", status="deploying")

    async def redeploy(self, deployment_id: str) -> Deployment:
        return Deployment(id=deployment_id, status="deploying")

    async def status(self, deployment_id: str) -> Deployment:
        self.status_calls += 1
        return Deployment(id=deployment_id, status="running", url=self.address)

    async def logs(self, deployment_id: str, lines: int = 200) -> str:
        return ""

    async def stop(self, deployment_id: str) -> None:
        return None


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
            build_pack="dockercompose",
            compose_path="/docker-compose.coolify.yml",
        )

    monkeypatch.setattr("blob_api.services.agents.read_manifest", fake_read)
    # The polls are real awaits; without this each install pays for them.
    monkeypatch.setattr("blob_api.services.agents.ADDRESS_POLL_SEC", 0.0)
    return stub


async def owner_who_may_host(client: Client) -> Client:
    owner = await sign_up(client, "Owner")
    await allow_policy(await workspace_id_of(owner))
    return owner


async def install(owner: Client) -> str:
    response = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO, "ref": "main"})
    assert response.status == 201, response.body
    return str(response.body["plugin"]["id"])


async def urls_of(plugin_id: str) -> tuple[str | None, str | None]:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT agui_url, request_url FROM plugins WHERE id = :id"),
                {"id": plugin_id},
            )
        ).one()
    return row.agui_url, row.request_url


class TestBeingAnswerable:
    async def test_installing_gives_the_agent_an_agui_url(
        self, hosted: Runner, client: Client
    ) -> None:
        owner = await owner_who_may_host(client)

        agui_url, _ = await urls_of(await install(owner))

        # The whole point. Without this the row is not a listener and every mention of the
        # agent does nothing at all, which is the hardest kind of broken to report.
        assert agui_url == "https://janus.example.com/v1/agui"

    async def test_the_webhook_url_is_still_composed_too(
        self, hosted: Runner, client: Client
    ) -> None:
        owner = await owner_who_may_host(client)

        _, request_url = await urls_of(await install(owner))

        assert request_url == "https://janus.example.com/blob/events"

    async def test_it_does_not_wait_for_a_human_to_open_the_console(
        self, hosted: Runner, client: Client
    ) -> None:
        owner = await owner_who_may_host(client)

        await install(owner)

        # The address used to arrive only when somebody rendered the deployment panel,
        # because that was the sole caller of `status`. An agent installed over the API
        # and never clicked on stayed unreachable forever.
        assert hosted.status_calls >= 1

    async def test_an_agent_with_no_agui_path_gets_no_agui_url(
        self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def webhook_only(repo_url: str, ref: str = "main") -> RepoSource:
            manifest = {k: v for k, v in MANIFEST.items() if k != "aguiPath"}
            return RepoSource(
                repo_url=repo_url,
                ref=ref,
                manifest=Manifest.model_validate({**manifest, "runtime": "container"}),
                build_pack="nixpacks",
            )

        monkeypatch.setattr("blob_api.services.agents.read_manifest", webhook_only)
        owner = await owner_who_may_host(client)

        agui_url, request_url = await urls_of(await install(owner))

        # A webhook app is a real thing and must not be handed a URL it does not serve:
        # Blob would POST runs at a path that 404s on every mention.
        assert agui_url is None
        assert request_url is not None

    async def test_a_runner_with_no_address_yet_does_not_fail_the_install(
        self, hosted: Runner, client: Client
    ) -> None:
        hosted.address = None
        owner = await owner_who_may_host(client)

        agui_url, _ = await urls_of(await install(owner))

        # Pending, not broken. The container is building and the console will pick the
        # address up; failing the install would strand a workspace holding a bot user.
        assert agui_url is None

    async def test_a_redeploy_keeps_the_url_it_had(self, hosted: Runner, client: Client) -> None:
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)

        assert (await owner.post(f"/api/admin/plugins/{plugin_id}/redeploy")).status == 200

        # `redeploy` reports no address, and COALESCE is what stops that NULL overwriting
        # a working URL — which would un-listen an agent that had been answering.
        agui_url, _ = await urls_of(plugin_id)
        assert agui_url == "https://janus.example.com/v1/agui"


class TestHowItIsBuilt:
    async def test_a_compose_agent_names_its_compose_file(
        self, hosted: Runner, client: Client
    ) -> None:
        owner = await owner_who_may_host(client)
        await install(owner)

        assert hosted.deployed is not None
        # An image whose entrypoint starts an interactive CLI only becomes a server when
        # a compose file overrides its command. Without this the container comes up
        # running a chat prompt nothing is attached to, listening on nothing.
        assert hosted.deployed["compose_path"] == "/docker-compose.coolify.yml"

    async def test_the_declared_port_reaches_the_runner_and_the_agent(
        self, hosted: Runner, client: Client
    ) -> None:
        owner = await owner_who_may_host(client)
        await install(owner)

        assert hosted.deployed is not None
        # Both, and they have to agree: the runner points its proxy at one number and the
        # agent binds the other. Disagreeing looks exactly like an agent that crashed.
        assert hosted.deployed["port"] == 8642
        assert hosted.deployed["env"]["PORT"] == "8642"


class TestWhatAManifestMayNotSay:
    """A repository describes an agent. It does not get to choose what Blob connects to."""

    async def test_a_repo_cannot_declare_its_own_agui_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured: dict[str, Any] = {}

        class Response:
            status_code = 200
            content = (
                b'{"slug":"evil","name":"Evil","version":"1.0.0",'
                b'"aguiUrl":"http://169.254.169.254/latest/meta-data"}'
            )

        class FakeClient:
            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_: Any) -> None:
                return None

            async def get(self, url: str) -> Response:
                captured["url"] = url
                return Response()

        monkeypatch.setattr(source_module.httpx, "AsyncClient", lambda **_: FakeClient())

        source = await source_module.read_manifest(REPO, "main")

        # `install_from_repo` never runs the SSRF guard — there is nothing to check at
        # manifest time — so a URL that survived this far would be POSTed to on every
        # mention. The cloud metadata endpoint is the canonical target and the reason
        # this is stripped rather than validated.
        assert source.manifest.agui_url is None

    def test_an_agui_path_may_not_smuggle_a_host(self) -> None:
        for smuggled in ("//evil.example/x", "http://evil.example/x", "https://evil/x"):
            with pytest.raises(ValueError):
                Manifest.model_validate({"slug": "a-bot", "name": "A", "aguiPath": smuggled})

    def test_a_relative_path_is_refused(self) -> None:
        with pytest.raises(ValueError):
            Manifest.model_validate({"slug": "a-bot", "name": "A", "aguiPath": "v1/agui"})

    def test_an_ordinary_path_is_kept(self) -> None:
        manifest = Manifest.model_validate({"slug": "a-bot", "name": "A", "aguiPath": "/v1/agui/"})
        # Normalised, so joining it to a base cannot produce a double slash.
        assert manifest.agui_path == "/v1/agui"

    async def test_an_unknown_build_pack_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class Response:
            status_code = 200
            content = b'{"slug":"a-bot","name":"A","version":"1.0.0","build":"magic"}'

        class FakeClient:
            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_: Any) -> None:
                return None

            async def get(self, url: str) -> Response:
                return Response()

        monkeypatch.setattr(source_module.httpx, "AsyncClient", lambda **_: FakeClient())

        with pytest.raises(AppError) as caught:
            await source_module.read_manifest(REPO, "main")
        assert caught.value.code == "manifest_invalid"


class TestTheWorkerKeepsLooking:
    """The deployment-sync cron: the heal nobody has to click for.

    `status` records the runner's current address, but its only callers were install
    and the console's deployment card — so a domain change on the runner side healed
    the stored URL only when a person happened to open the right screen. Found live:
    a certificate error outlasted the domain fix by exactly that click.
    """

    async def test_a_domain_change_heals_the_stored_url(
        self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings
        from blob_api.jobs.deployments import sync_hosted_agents

        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        # The deployment is repointed after install; nobody opens the console.
        hosted.address = "janus.new.example.com"
        monkeypatch.setattr(settings, "COOLIFY_API_URL", "https://coolify.example.com")

        assert await sync_hosted_agents({}) == 1

        agui_url, request_url = await urls_of(plugin_id)
        assert agui_url == "https://janus.new.example.com/v1/agui"
        assert request_url == "https://janus.new.example.com/blob/events"

    async def test_without_a_runner_configured_the_sync_stays_home(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings
        from blob_api.jobs.deployments import sync_hosted_agents

        monkeypatch.setattr(settings, "COOLIFY_API_URL", None)
        assert await sync_hosted_agents({}) == 0

    async def test_a_broken_runner_is_logged_and_survived(
        self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings
        from blob_api.jobs.deployments import sync_hosted_agents

        owner = await owner_who_may_host(client)
        await install(owner)
        monkeypatch.setattr(settings, "COOLIFY_API_URL", "https://coolify.example.com")

        async def broken(deployment_id: str) -> Deployment:
            raise RuntimeError("the runner is down")

        monkeypatch.setattr(hosted, "status", broken)

        # No exception escapes into the cron, and the count says nothing synced.
        assert await sync_hosted_agents({}) == 0
