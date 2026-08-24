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

import logging

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.errors import AppError, bad_request
from ..plugins import registry
from ..plugins.runner import AGENT_PORT, Deployment, current_runner, normalize_fqdn
from ..plugins.source import RepoSource, read_manifest
from ..services import audit as audit_service
from ..services.audit import Actor
from . import commands as command_service

log = logging.getLogger("blob.agents")


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
    deploy_env = {
        **(env or {}),
        "__build_pack__": source.build_pack,
        "BLOB_BASE_URL": public_url,
        "BLOB_BOT_TOKEN": installed.bot_token,
        "BLOB_SIGNING_SECRET": installed.signing_secret,
        "BLOB_PLUGIN_SLUG": source.manifest.slug,
        # The same number the runner is told to route to, so an agent can bind what it
        # is actually reached on instead of guessing.
        "PORT": str(AGENT_PORT),
    }

    try:
        deployment = await runner.deploy(
            slug=source.manifest.slug, repo=source.repo_url, ref=source.ref, env=deploy_env
        )
    except AppError as exc:
        await _record_failure(installed.plugin_id, exc.message)
        raise

    await _record_deployment(installed.plugin_id, deployment)
    return installed, source


async def redeploy(actor: Actor, plugin_id: str) -> Deployment:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, actor.workspace_id)

    deployment_id = _require_deployment(plugin)
    deployment = await runner.redeploy(deployment_id)
    await _record_deployment(plugin_id, deployment)

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


async def status(workspace_id: str, plugin_id: str) -> Deployment:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, workspace_id)

    deployment = await runner.status(_require_deployment(plugin))
    await _record_deployment(plugin_id, deployment)
    return deployment


async def logs(workspace_id: str, plugin_id: str, lines: int = 200) -> str:
    runner = current_runner()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, workspace_id)

    return await runner.logs(_require_deployment(plugin), lines)


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


async def _record_deployment(plugin_id: str, deployment: Deployment) -> None:
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
                       -- The runner assigns the hostname, so the callback URL is only
                       -- knowable once it has answered.
                       request_url = COALESCE(:url, request_url)
                 WHERE id = :id
                """
            ),
            {
                "id": plugin_id,
                "deployment_id": deployment.id,
                "status": deployment.status,
                "url": f"{base}/blob/events" if base else None,
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


__all__ = ["install_from_repo", "logs", "preview", "redeploy", "status", "stop"]
