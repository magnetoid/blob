"""The Janus page's server half: what this instance's agent runs on.

Three routes, all for an instance admin, all thin. `JANUS_API_SERVER_KEY` is full control
of Janus's API — its runs, its configuration, its restart — so who may reach it is the
only decision made here, and everything else belongs to `services/janus_console.py`.

`data` on the five parts is deliberately untyped. Janus's `/v1/config` grows fields with
every release and the page reads them; a Blob-side mirror of that shape would be a second
thing to keep in step, and the one field that is *about* a secret — `providers[].key` — is
narrowed in the service, where it cannot be forgotten.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_instance_admin
from ..schemas.base import CamelModel
from ..services import janus_console
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/janus")


class JanusPartOut(CamelModel):
    """One of Janus's routes: its answer, or the reason there isn't one."""

    data: Any | None = None
    error: str | None = None


class JanusInstallOut(CamelModel):
    workspace_id: str
    workspace_name: str
    plugin_id: str
    status: str
    channel_count: int
    runs_last_week: int
    is_this_workspace: bool


class JanusOverviewOut(CamelModel):
    health: JanusPartOut
    capabilities: JanusPartOut
    config: JanusPartOut
    skills: JanusPartOut
    toolsets: JanusPartOut
    agui_url: str | None
    secret_set: bool
    installs: list[JanusInstallOut]


class JanusConfigChangeIn(CamelModel):
    """The camelCase twin of Janus's `PUT /v1/config` body. Every field optional.

    Unvalidated beyond its shape on purpose: Janus validates the meaning — unknown keys,
    a `max_turns` that arrived as a string, a name that is not an API key — and answers
    with a sentence the page shows. A second copy of those rules here would be one that
    drifts, and the one it would drift *against* is a release Blob does not ship.
    """

    model: dict[str, Any] | None = None
    agent: dict[str, Any] | None = None
    toolsets: list[str] | None = None
    #: Values pass straight through to Janus and are never stored, logged or returned.
    api_keys: dict[str, str] | None = None
    raw: str | None = None
    restart: bool | None = None


class JanusAppliedOut(CamelModel):
    """Janus's answer to a write: what landed, what it warns about, whether it is going."""

    applied: dict[str, Any]
    warnings: list[dict[str, Any]]
    restarting: bool
    drain_timeout_seconds: float


def _applied_out(applied: janus_console.Applied) -> JanusAppliedOut:
    return JanusAppliedOut(
        applied=applied.applied,
        warnings=applied.warnings,
        restarting=applied.restarting,
        drain_timeout_seconds=applied.drain_timeout_seconds,
    )


@router.get("", response_model=JanusOverviewOut)
async def janus_overview(
    admin: SessionUser = Depends(require_instance_admin),
) -> JanusOverviewOut:
    """Janus as a whole: what it is, and every workspace that has it."""
    async with session_scope() as session:
        overview = await janus_console.overview(session, admin.workspace_id)

    return JanusOverviewOut(
        health=JanusPartOut(data=overview.health.data, error=overview.health.error),
        capabilities=JanusPartOut(
            data=overview.capabilities.data, error=overview.capabilities.error
        ),
        config=JanusPartOut(data=overview.config.data, error=overview.config.error),
        skills=JanusPartOut(data=overview.skills.data, error=overview.skills.error),
        toolsets=JanusPartOut(data=overview.toolsets.data, error=overview.toolsets.error),
        agui_url=overview.agui_url,
        secret_set=overview.secret_set,
        installs=[
            JanusInstallOut(
                workspace_id=install.workspace_id,
                workspace_name=install.workspace_name,
                plugin_id=install.plugin_id,
                status=install.status,
                channel_count=install.channel_count,
                runs_last_week=install.runs_last_week,
                is_this_workspace=install.is_this_workspace,
            )
            for install in overview.installs
        ],
    )


@router.put("/config", response_model=JanusAppliedOut)
async def update_janus_config(
    payload: JanusConfigChangeIn,
    request: Request,
    admin: SessionUser = Depends(require_instance_admin),
) -> JanusAppliedOut:
    """Change what Janus runs on, and by default restart it into the change."""
    async with transaction() as (session, _):
        applied = await janus_console.update(
            session,
            actor_for(request, admin),
            janus_console.ConfigChange(
                model=payload.model,
                agent=payload.agent,
                toolsets=payload.toolsets,
                api_keys=payload.api_keys,
                raw=payload.raw,
                restart=payload.restart,
            ),
        )
    return _applied_out(applied)


@router.post("/restart", response_model=JanusAppliedOut)
async def restart_janus(
    request: Request,
    admin: SessionUser = Depends(require_instance_admin),
) -> JanusAppliedOut:
    """Restart the gateway without changing anything it runs on."""
    async with transaction() as (session, _):
        applied = await janus_console.restart(session, actor_for(request, admin))
    return _applied_out(applied)
