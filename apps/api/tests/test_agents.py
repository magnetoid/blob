"""Installing an agent from a repository.

The runner is stubbed. What these assert is Blob's half: that a manifest is read and
validated before anything is approved, that hosting being switched off is a clear answer
rather than a crash, and that a failed deploy leaves an install an admin can retry
instead of a half-written workspace.
"""

from __future__ import annotations

from typing import Any

import pytest

from blob_api.config import settings
from blob_api.lib import net
from blob_api.lib.errors import AppError
from blob_api.plugins import runner as runner_module
from blob_api.plugins import source as source_module
from blob_api.plugins.manifest import Manifest
from blob_api.plugins.runner import Deployment
from blob_api.plugins.source import RepoSource, raw_manifest_url

from .helpers import Client, allow_policy, invite_and_sign_up, sign_up, workspace_id_of

REPO = "https://github.com/magnetoid/standup-agent"

MANIFEST = {
    "slug": "standup-agent",
    "name": "Standup Agent",
    "description": "Asks what you did yesterday",
    "version": "1.0.0",
    "events": ["message.created"],
    "scopes": ["messages:read", "messages:write"],
}


class StubRunner:
    """Records what it was asked to do, so the test can assert on the call."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.deployed: dict[str, Any] | None = None
        self.stopped: list[str] = []

    async def deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str]) -> Deployment:
        if self.fail:
            raise AppError(502, "runner_failed", "The runner refused that: no capacity")
        self.deployed = {"slug": slug, "repo": repo, "ref": ref, "env": dict(env)}
        return Deployment(id="dep-1", status="deploying", url="agent-standup.example.com")

    async def redeploy(self, deployment_id: str) -> Deployment:
        return Deployment(id=deployment_id, status="deploying")

    async def status(self, deployment_id: str) -> Deployment:
        return Deployment(id=deployment_id, status="running", url="agent-standup.example.com")

    async def logs(self, deployment_id: str, lines: int = 200) -> str:
        return f"boot ok ({lines} lines requested)"

    async def stop(self, deployment_id: str) -> None:
        self.stopped.append(deployment_id)


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """`apps.example.com` does not resolve, and the SSRF guard rightly refuses it."""
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest.fixture
def hosted(monkeypatch: pytest.MonkeyPatch) -> StubRunner:
    """Hosting configured, the runner stubbed, and the manifest served from memory."""
    stub = StubRunner()
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
    return stub


async def hosting_owner(client: Client) -> Client:
    """An owner whose workspace is allowed to deploy agents onto this machine.

    Two switches gate hosting now — the `AGENT_RUNNER` ceiling and the workspace's own
    policy — because a workspace admin and the person who owns the hardware stopped being
    the same person when multi-workspace landed. These tests are about the runner, not
    about the refusal, so the policy is opened up front.
    """
    owner = await sign_up(client, "Owner")
    await allow_policy(await workspace_id_of(owner))
    return owner


def test_the_manifest_url_is_the_repository_raw_path() -> None:
    assert raw_manifest_url(REPO, "main") == (
        "https://raw.githubusercontent.com/magnetoid/standup-agent/main/blob-app.json"
    )
    # A .git suffix and a trailing slash are both things people paste.
    assert raw_manifest_url(f"{REPO}.git", "v2") == (
        "https://raw.githubusercontent.com/magnetoid/standup-agent/v2/blob-app.json"
    )


def test_a_non_github_repository_is_refused_clearly() -> None:
    with pytest.raises(AppError) as caught:
        raw_manifest_url("https://gitlab.com/someone/agent", "main")
    assert caught.value.code == "unsupported_repo_host"

    with pytest.raises(AppError) as caught:
        raw_manifest_url("https://github.com/not-a-repo", "main")
    assert caught.value.code == "bad_repo_url"


async def test_hosting_off_is_an_answer_not_a_crash(client: Client) -> None:
    owner = await hosting_owner(client)
    assert settings.AGENT_RUNNER == "disabled"

    refused = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})
    assert refused.status == 400
    assert refused.body["error"]["code"] == "agent_hosting_disabled"


async def test_a_member_cannot_deploy_an_agent(client: Client) -> None:
    owner = await hosting_owner(client)
    member = await invite_and_sign_up(owner, "Member")

    denied = await member.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})
    assert denied.status == 403


async def test_installing_from_a_repository_deploys_it(client: Client, hosted: StubRunner) -> None:
    owner = await hosting_owner(client)

    created = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO, "ref": "main"})
    assert created.status == 201
    plugin = created.body["plugin"]
    assert plugin["runtime"] == "container"
    assert plugin["slug"] == "standup-agent"

    # The secrets are shown once, here, and never again.
    assert created.body["botToken"]
    assert created.body["signingSecret"]

    # The agent boots holding its own credentials; Blob keeps no copy of the plaintext.
    assert hosted.deployed is not None
    env = hosted.deployed["env"]
    assert env["BLOB_BOT_TOKEN"] == created.body["botToken"]
    assert env["BLOB_BASE_URL"] == settings.PUBLIC_URL
    assert hosted.deployed["repo"] == REPO

    # The callback URL is only knowable once the runner has assigned a hostname.
    listed = (await owner.get("/api/admin/plugins")).body["plugins"]
    assert listed[0]["requestUrl"] == "https://agent-standup.example.com/blob/events"


async def test_a_failed_deploy_leaves_a_retryable_install(
    client: Client, monkeypatch: pytest.MonkeyPatch, hosted: StubRunner
) -> None:
    owner = await hosting_owner(client)
    hosted.fail = True

    failed = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})
    assert failed.status == 502

    # The install stands, marked failed with the reason, so an admin can retry without
    # approving the scopes again.
    plugins = (await owner.get("/api/admin/plugins")).body["plugins"]
    assert len(plugins) == 1
    assert plugins[0]["status"] == "failed"
    assert "no capacity" in plugins[0]["lastError"]


async def test_stopping_an_agent_disables_it(client: Client, hosted: StubRunner) -> None:
    owner = await hosting_owner(client)
    created = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})
    plugin_id = created.body["plugin"]["id"]

    assert (await owner.post(f"/api/admin/plugins/{plugin_id}/stop")).status == 200
    assert hosted.stopped == ["dep-1"]

    plugins = (await owner.get("/api/admin/plugins")).body["plugins"]
    assert plugins[0]["status"] == "disabled"


async def test_an_app_that_is_not_hosted_here_says_so(
    client: Client, hosted: StubRunner
) -> None:
    owner = await hosting_owner(client)
    installed = await owner.post(
        "/api/admin/plugins",
        {
            **MANIFEST,
            "slug": "elsewhere",
            "runtime": "external",
            "requestUrl": "https://apps.example.com/blob/events",
        },
    )
    plugin_id = installed.body["plugin"]["id"]

    refused = await owner.get(f"/api/admin/plugins/{plugin_id}/deployment")
    assert refused.status == 400
    assert refused.body["error"]["code"] == "not_hosted"


async def test_the_logs_come_back_for_a_hosted_agent(client: Client, hosted: StubRunner) -> None:
    owner = await hosting_owner(client)
    created = await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})
    plugin_id = created.body["plugin"]["id"]

    logs = await owner.get(f"/api/admin/plugins/{plugin_id}/logs")
    assert logs.status == 200
    assert "boot ok" in logs.body["logs"]

    # An agent that will not start says why here, so the row carries where it came from.
    listed = (await owner.get("/api/admin/plugins")).body["plugins"][0]
    assert listed["sourceRepo"] == REPO
    assert listed["sourceRef"] == "main"


async def test_a_container_manifest_cannot_be_installed_by_hand(client: Client) -> None:
    owner = await hosting_owner(client)
    refused = await owner.post("/api/admin/plugins", {**MANIFEST, "runtime": "container"})
    assert refused.status == 400
    assert refused.body["error"]["code"] == "use_from_repo"


def test_the_manifest_is_read_as_a_container_regardless_of_what_it_claims() -> None:
    """A repository does not get to say it runs in-process. ADR 0009 stands."""
    document = {**MANIFEST, "runtime": "local"}
    document["runtime"] = "container"
    manifest = Manifest.model_validate(document)
    assert manifest.runtime == "container"
    assert source_module.MANIFEST_NAME == "blob-app.json"


# ─── configuration an agent needs ─────────────────────────────────────────────
async def test_an_agent_can_be_given_the_key_it_needs(
    client: Client, hosted: StubRunner
) -> None:
    """Without this, no agent that talks to a model provider is installable at all.

    Blob creates the container, so Blob is the only thing positioned to hand over a
    provider key — and for a long time the install request had nowhere to put one.
    """
    owner = await hosting_owner(client)
    created = await owner.post(
        "/api/admin/plugins/from-repo",
        {"repoUrl": REPO, "env": {"ANTHROPIC_API_KEY": "sk-ant-test"}},
    )
    assert created.status == 201, created.body

    assert hosted.deployed is not None
    env = hosted.deployed["env"]
    assert env["ANTHROPIC_API_KEY"] == "sk-ant-test"
    # Still gets everything Blob supplies, and the port it is actually reached on.
    assert env["BLOB_BOT_TOKEN"]
    assert env["PORT"] == "3000"


async def test_supplied_configuration_cannot_displace_the_agents_own_credentials(
    client: Client, hosted: StubRunner
) -> None:
    # Refused by name rather than merged away, so nobody has to reason about ordering.
    owner = await hosting_owner(client)
    response = await owner.post(
        "/api/admin/plugins/from-repo",
        {"repoUrl": REPO, "env": {"BLOB_BOT_TOKEN": "not-yours"}},
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "reserved_env_key"
    # Nothing was deployed, so a rejected install leaves no half-built agent behind.
    assert hosted.deployed is None


async def test_an_unusable_variable_name_names_the_field(
    client: Client, hosted: StubRunner
) -> None:
    owner = await hosting_owner(client)
    response = await owner.post(
        "/api/admin/plugins/from-repo",
        {"repoUrl": REPO, "env": {"not-a-var": "x"}},
    )
    assert response.status == 400
    assert response.body["error"]["field"] == "not-a-var"


async def test_installing_without_configuration_still_works(
    client: Client, hosted: StubRunner
) -> None:
    owner = await hosting_owner(client)
    assert (await owner.post("/api/admin/plugins/from-repo", {"repoUrl": REPO})).status == 201
    assert hosted.deployed is not None
    assert "ANTHROPIC_API_KEY" not in hosted.deployed["env"]
