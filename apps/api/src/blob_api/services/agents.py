"""Installing an agent from a repository, and hosting it.

Three things have to happen and the order matters. The plugin row, its grants, its bot
user and its tokens are written first and committed; only then does the runner get asked
to start a container. That is the same persist-then-act discipline the rest of the
codebase follows — an agent must never boot, call back, and find no workspace record of
itself.

If the deploy fails the install stands, marked `failed` with the reason. The admin can
retry without re-approving scopes, and a workspace is never left holding a bot user whose
plugin does not exist.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlsplit

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.errors import AppError, bad_request
from ..plugins import registry
from ..plugins.runner import AGENT_PORT, Deployment, EnvVar, current_runner, normalize_fqdn
from ..plugins.source import RepoSource, read_manifest
from ..services import audit as audit_service
from ..services.audit import Actor
from . import commands as command_service

log = logging.getLogger("blob.agents")

#: How hard to chase the runner for a hostname before letting the install finish anyway.
#: Coolify assigns one within a second or two of creating the application; the retries are
#: for the case where it does not, not for waiting out a build.
ADDRESS_ATTEMPTS = 4
ADDRESS_POLL_SEC = 1.5


async def preview(repo_url: str, ref: str) -> RepoSource:
    """Read the manifest so the console can show what is about to be approved."""
    return await read_manifest(repo_url, ref)


async def install_from_repo(
    actor: Actor, repo_url: str, ref: str, public_url: str, env: dict[str, str] | None = None
) -> tuple[registry.Installed, RepoSource]:
    # Hosting first. Reading the manifest is a network call, and making it before
    # discovering there is nowhere to run the result wastes it and reports the wrong
    # problem — "no manifest at that URL" when the real answer is "hosting is off".
    runner = current_runner()
    source = await read_manifest(repo_url, ref)

    async with transaction() as (session, _):
        installed = await registry.install(
            session,
            workspace_id=actor.workspace_id,
            manifest=source.manifest,
            installed_by=actor.id,
            source_repo=source.repo_url,
            source_ref=source.ref,
            reserved_commands=command_service.builtin_names(),
        )
        await audit_service.record(
            session,
            actor,
            "plugin.installed",
            target_type="plugin",
            target_id=installed.plugin_id,
            metadata={"repo": source.repo_url, "ref": source.ref, "runtime": "container"},
        )

    # Past the commit. The agent's credentials go to the container and nowhere else —
    # this is the only moment the bot token exists in plaintext outside the response.
    #
    # Operator configuration goes underneath, so a supplied key can never displace the
    # credentials Blob issues; the names are refused up front as well, and this ordering
    # is the belt to that pair of braces. None of it is stored: the runner holds the one
    # copy, which is what lets a redeploy work without asking for the key again.
    port = source.manifest.port or AGENT_PORT
    deploy_env = {
        **(env or {}),
        "__build_pack__": source.build_pack,
        "BLOB_BASE_URL": public_url,
        "BLOB_BOT_TOKEN": installed.bot_token,
        "BLOB_SIGNING_SECRET": installed.signing_secret,
        "BLOB_PLUGIN_SLUG": source.manifest.slug,
        # The same number the runner is told to route to, so an agent can bind what it
        # is actually reached on instead of guessing.
        "PORT": str(port),
    }

    try:
        deployment = await runner.deploy(
            slug=source.manifest.slug,
            repo=source.repo_url,
            ref=source.ref,
            env=deploy_env,
            port=port,
            compose_path=source.compose_path,
        )
    except AppError as exc:
        await _record_failure(installed.plugin_id, exc.message)
        raise

    await _record_deployment(installed.plugin_id, deployment, agui_path=source.manifest.agui_path)
    # `deploy` answers before the runner has assigned a hostname, so the row above still
    # has no URL — and until it does, the agent is not a listener and not a delivery
    # target. Nothing in the system ever went back to look: the only thing that called
    # `status()` was the console rendering the deployment panel, so an agent installed
    # over the API and never clicked on stayed mute forever, with no error anywhere.
    await _await_address(actor.workspace_id, installed.plugin_id, source.manifest.agui_path)
    return installed, source


async def _await_address(workspace_id: str, plugin_id: str, agui_path: str | None) -> None:
    """Ask the runner for the hostname until it has one, within reason.

    Bounded and non-fatal. A runner that is slow to assign a domain must not fail an
    install that otherwise succeeded — the row is written, the container is building, and
    opening the agent in the console runs `status()` again. This only removes the
    *requirement* that somebody does.
    """
    for attempt in range(ADDRESS_ATTEMPTS):
        if attempt:
            await asyncio.sleep(ADDRESS_POLL_SEC)
        try:
            deployment = await status(workspace_id, plugin_id, agui_path=agui_path)
        except AppError:
            return
        if deployment.url:
            return
    log.info("agent %s has no address yet; the console will pick it up", plugin_id)


async def redeploy(actor: Actor, plugin_id: str) -> Deployment:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, actor.workspace_id)

    deployment_id = _require_deployment(plugin)
    deployment = await runner.redeploy(deployment_id)
    await _record_deployment(plugin_id, deployment, agui_path=_agui_path_of(plugin))

    async with transaction() as (session, _):
        await audit_service.record(
            session,
            actor,
            "plugin.redeployed",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"ref": plugin.source_ref or ""},
        )
    return deployment


async def status(workspace_id: str, plugin_id: str, *, agui_path: str | None = None) -> Deployment:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, workspace_id)

    deployment = await runner.status(_require_deployment(plugin))
    await _record_deployment(plugin_id, deployment, agui_path=agui_path or _agui_path_of(plugin))
    return deployment


def _agui_path_of(plugin: object) -> str | None:
    """Recover the declared path from the URL already stored, so a redeploy keeps it.

    The manifest is not kept after install — only what it produced — and a redeploy that
    dropped the path would silently un-listen an agent that had been answering. Splitting
    the stored URL is the cheapest way to hold onto it without a column that would have to
    be migrated.
    """
    stored = getattr(plugin, "agui_url", None)
    if not stored:
        return None
    path = urlsplit(str(stored)).path
    return path or None


async def logs(workspace_id: str, plugin_id: str, lines: int = 200) -> str:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, workspace_id)

    return await runner.logs(_require_deployment(plugin), lines)


async def env(workspace_id: str, plugin_id: str) -> list[EnvVar]:
    """What the agent is configured with, as the runner holds it."""
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, workspace_id)

    return await runner.env(_require_deployment(plugin))


async def set_env(actor: Actor, plugin_id: str, values: dict[str, str], remove: list[str]) -> None:
    """Write configuration, then say so — without ever writing a value into the log.

    The audit entry records the *names* that changed and nothing else. An agent's
    configuration is where its API keys live, and an append-only log of every secret ever
    set is a worse artefact than no log at all.

    A redeploy is not triggered. Coolify applies environment on the next start, so this
    leaves the console holding the decision: an operator setting three values wants one
    restart at the end, not three.
    """
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, actor.workspace_id)

    deployment_id = _require_deployment(plugin)
    for key, value in values.items():
        await runner.set_env(deployment_id, key, value)
    for key in remove:
        await runner.unset_env(deployment_id, key)

    async with transaction() as (session, _):
        await audit_service.record(
            session,
            actor,
            "plugin.env_updated",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"set": sorted(values), "removed": sorted(remove)},
        )


async def stop(actor: Actor, plugin_id: str) -> None:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, actor.workspace_id)

    await runner.stop(_require_deployment(plugin))

    async with transaction() as (session, _):
        await session.execute(
            text(
                "UPDATE plugins SET deployment_status = 'stopped', status = 'disabled' "
                "WHERE id = :id"
            ),
            {"id": plugin_id},
        )
        await audit_service.record(
            session, actor, "plugin.stopped", target_type="plugin", target_id=plugin_id
        )


def _require_deployment(plugin: object) -> str:
    deployment_id = getattr(plugin, "deployment_id", None)
    if not deployment_id:
        raise bad_request(
            "That app is not hosted here — it runs wherever its author put it.",
            code="not_hosted",
        )
    return str(deployment_id)


async def _record_deployment(
    plugin_id: str, deployment: Deployment, *, agui_path: str | None = None
) -> None:
    # Normalized here rather than trusting the runner, because this is the one place the
    # callback URL is built and a runner is an interface anyone can implement. Coolify
    # alone reports two different shapes.
    base = normalize_fqdn(deployment.url)

    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                UPDATE plugins
                   SET deployment_id = :deployment_id,
                       deployment_status = :status,
                       -- The runner assigns the hostname, so both URLs are only knowable
                       -- once it has answered. COALESCE keeps what is already there when
                       -- it has not: a redeploy reports no address, and overwriting a
                       -- working URL with NULL would un-listen a live agent.
                       request_url = COALESCE(:url, request_url),
                       agui_url = COALESCE(:agui_url, agui_url)
                 WHERE id = :id
                """
            ),
            {
                "id": plugin_id,
                "deployment_id": deployment.id,
                "status": deployment.status,
                "url": f"{base}/blob/events" if base else None,
                # This line is what makes a hosted AG-UI agent answerable at all.
                # `listeners_for` admits a plugin only when `agui_url` is set or its
                # runtime dials in, and nothing ever set it for a container agent.
                "agui_url": f"{base}{agui_path}" if base and agui_path else None,
            },
        )


async def _record_failure(plugin_id: str, reason: str) -> None:
    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                UPDATE plugins
                   SET status = 'failed', deployment_status = 'failed', last_error = :reason
                 WHERE id = :id
                """
            ),
            {"id": plugin_id, "reason": reason[:500]},
        )
    log.warning("agent %s failed to deploy: %s", plugin_id, reason)


__all__ = [
    "env",
    "install_from_repo",
    "logs",
    "preview",
    "redeploy",
    "set_env",
    "status",
    "stop",
]
