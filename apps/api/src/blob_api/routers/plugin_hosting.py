"""Agents hosted from a repository: deployment, logs, and environment.

The registry half of the console lives in routers/plugins.py — what an app *is*.
This file is what Blob *runs for it*: install-from-repo through the runner (ADR 0010),
deployment status and logs, and the environment screen with its Coolify-shaped
delete-then-create repair. Same prefix, same admin gate; split because the two halves
share little beyond the row they describe.
"""

from __future__ import annotations

from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import AppError
from ..plugins import registry, runner
from ..plugins.env import RESERVED_NAMES as RESERVED_ENV_NAMES
from ..plugins.env import RESERVED_PREFIX, validate_env
from ..schemas.base import CamelModel
from ..services import agents as agent_service
from ..services import policies as policy_service
from ..services.audit import actor_for
from .plugins import InstalledOut, OkOut, _assert_within_policy, _to_plugin

router = APIRouter(tags=["admin"], prefix="/api/admin/plugins")


class RepoInput(CamelModel):
    repo_url: str = Field(min_length=1, max_length=300)
    ref: str = Field(default="main", min_length=1, max_length=100)
    #: Configuration the agent needs and Blob cannot know — a model provider's key being
    #: the usual one. Passed to the runner and never stored here.
    env: dict[str, str] | None = None


class RepoPreviewOut(CamelModel):
    """What the console shows before anyone approves anything."""

    repo_url: str
    ref: str
    slug: str
    name: str
    description: str | None = None
    version: str
    build: str
    events: list[str]
    scopes: list[str]


class DeploymentOut(CamelModel):
    deployment_id: str | None = None
    status: str
    url: str | None = None


class LogsOut(CamelModel):
    logs: str


class EnvVarOut(CamelModel):
    key: str
    #: Present only for a value that is not a secret. See `_env_out` for the rule.
    value: str | None = None
    #: What a secret looks like without being one: how long it is, and its last four
    #: characters. Enough to tell "the key I pasted" from "the key that is still empty",
    #: which is the question anyone opening this screen is actually asking.
    hint: str | None = None
    secret: bool = False
    managed: bool = False
    #: True when the runner holds more than one row for this key — the failure that makes
    #: an agent ignore the value the console is showing.
    duplicated: bool = False


class EnvOut(CamelModel):
    env: list[EnvVarOut]
    #: Names Blob sets itself, echoed so the console can show them as fixed rather than
    #: appearing to have lost them.
    reserved: list[str]


class EnvInput(CamelModel):
    set: dict[str, str] = {}
    remove: list[str] = []
    #: Restart afterwards. Environment only reaches the container on the next start, so
    #: without this the console would be showing a value the running agent does not have.
    restart: bool = False


@router.post("/preview-repo", response_model=RepoPreviewOut)
async def preview_repo(
    payload: RepoInput, admin: SessionUser = Depends(require_admin)
) -> RepoPreviewOut:
    """Read the manifest so the scopes can be approved before anything is installed."""
    source = await agent_service.preview(payload.repo_url, payload.ref)
    return RepoPreviewOut(
        repo_url=source.repo_url,
        ref=source.ref,
        slug=source.manifest.slug,
        name=source.manifest.name,
        description=source.manifest.description,
        version=source.manifest.version,
        build=source.build_pack,
        events=sorted(set(source.manifest.events)),
        scopes=sorted(set(source.manifest.scopes)),
    )


@router.post("/from-repo", response_model=InstalledOut, status_code=201)
async def install_from_repo(
    payload: RepoInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> InstalledOut:
    # The sharpest capability on this router: it ends with the repository's code running
    # as a container on the operator's machine. ADR 0010 says so plainly, and until
    # multi-tenancy the operator and this admin were the same person.
    async with session_scope() as session:
        # `stored_for`, not `effective_for`: the environment ceiling for hosting is
        # enforced downstream by `current_runner`, which refuses with
        # `agent_hosting_disabled` and tells the admin to configure AGENT_RUNNER. Asking
        # the combined answer here would shadow that with "ask an administrator", which
        # is the wrong advice when the administrator is the person reading it.
        policy = await policy_service.stored_for(session, admin.workspace_id)
        if not policy.may_host_agents:
            raise policy_service.refuse_hosting()
        await _assert_within_policy(session, admin.workspace_id, policy, [])

    installed, _source = await agent_service.install_from_repo(
        actor_for(request, admin),
        payload.repo_url,
        payload.ref,
        settings.PUBLIC_URL,
        env=validate_env(payload.env),
    )
    async with session_scope() as session:
        row = await registry.by_id(session, installed.plugin_id, admin.workspace_id)
        plugin = await _to_plugin(session, row)

    return InstalledOut(
        plugin=plugin,
        signing_secret=installed.signing_secret,
        bot_token=installed.bot_token,
    )


@router.get("/{plugin_id}/deployment", response_model=DeploymentOut)
async def deployment_status(
    plugin_id: str, admin: SessionUser = Depends(require_admin)
) -> DeploymentOut:
    deployment = await agent_service.status(admin.workspace_id, plugin_id)
    return DeploymentOut(deployment_id=deployment.id, status=deployment.status, url=deployment.url)


@router.post("/{plugin_id}/redeploy", response_model=DeploymentOut)
async def redeploy(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> DeploymentOut:
    deployment = await agent_service.redeploy(actor_for(request, admin), plugin_id)
    return DeploymentOut(deployment_id=deployment.id, status=deployment.status, url=deployment.url)


@router.get("/{plugin_id}/logs", response_model=LogsOut)
async def deployment_logs(
    plugin_id: str,
    lines: Annotated[int, Query(ge=10, le=1000)] = 200,
    admin: SessionUser = Depends(require_admin),
) -> LogsOut:
    """What the container has written. Where an agent that will not start says why."""
    return LogsOut(logs=await agent_service.logs(admin.workspace_id, plugin_id, lines))


@router.post("/{plugin_id}/stop", response_model=OkOut)
async def stop_agent(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    await agent_service.stop(actor_for(request, admin), plugin_id)
    return OkOut()


#: Name fragments that mean "do not put this on a screen". A heuristic, and treated as
#: one: it is tidiness rather than a boundary, because the same admin can read the real
#: value out of the agent's own environment through the terminal. What it buys is that a
#: console left open, screen-shared or screenshotted does not have an API key on it.
SECRET_HINTS = ("KEY", "SECRET", "TOKEN", "PASSWORD", "PASS", "CREDENTIAL", "AUTH", "PRIVATE")


def _env_out(values: list[runner.EnvVar]) -> list[EnvVarOut]:
    seen = Counter(item.key for item in values)
    out: list[EnvVarOut] = []
    # Sorted by name: the runner returns insertion order, which puts the value somebody
    # added last at the bottom of a list of twenty-five and nowhere near the one it
    # duplicates.
    for item in sorted(values, key=lambda v: v.key):
        secret = any(hint in item.key.upper() for hint in SECRET_HINTS)
        out.append(
            EnvVarOut(
                key=item.key,
                value=None if secret else item.value,
                hint=_hint(item.value) if secret else None,
                secret=secret,
                managed=item.managed,
                duplicated=seen[item.key] > 1,
            )
        )
    return out


def _hint(value: str) -> str:
    """Enough of a secret to recognise it, never enough to use it."""
    if not value:
        return "not set"
    return f"{len(value)} characters, ending {value[-4:]}" if len(value) > 8 else "set"


@router.get("/{plugin_id}/env", response_model=EnvOut)
async def agent_env(plugin_id: str, admin: SessionUser = Depends(require_admin)) -> EnvOut:
    """What a hosted agent is configured with.

    The form half of setting an agent up. The other half is the terminal, and the split
    is not arbitrary: a value an agent declares it needs belongs in a field, while a
    device-code login — which prints a URL, waits, and completes somewhere else entirely —
    cannot be expressed as one no matter how the form is drawn.
    """
    values = await agent_service.env(admin.workspace_id, plugin_id)
    return EnvOut(env=_env_out(values), reserved=sorted(RESERVED_ENV_NAMES))


@router.put("/{plugin_id}/env", response_model=EnvOut)
async def update_agent_env(
    plugin_id: str,
    payload: EnvInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> EnvOut:
    actor = actor_for(request, admin)
    values = validate_env(payload.set)

    removing = [name.strip() for name in payload.remove if name.strip()]
    for name in removing:
        # Checked on the way out as well as the way in. Nothing else stops an admin
        # deleting the bot token the agent authenticates with and turning a working agent
        # into one that fails every callback with no explanation.
        if name.upper().startswith(RESERVED_PREFIX):
            raise AppError(
                400, "reserved_env_key", f'"{name}" is set by Blob and cannot be removed.', name
            )

    await agent_service.set_env(actor, plugin_id, values, removing)
    if payload.restart:
        await agent_service.redeploy(actor, plugin_id)

    return EnvOut(
        env=_env_out(await agent_service.env(admin.workspace_id, plugin_id)),
        reserved=sorted(RESERVED_ENV_NAMES),
    )


__all__ = ["router"]
