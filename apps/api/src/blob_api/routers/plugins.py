"""Managing installed apps.

Admin-only, and audited like everything else in the console. Two things here are
deliberate rather than incidental:

**Secrets are shown once.** The signing secret and the bot token are returned by the
install call and never again — only their hash, or nothing at all, is stored. Rotating is
the recovery path, not retrieval.

**Local plugins cannot be installed through this API.** Installing one is equivalent to
deploying server code: it runs in this process, with this process's database credentials
and environment. Making that a filesystem-plus-restart operation means it goes through
whatever review a deploy goes through, instead of being something an admin session can do
to the server. This endpoint registers external apps only.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import bad_request
from ..lib.net import check_outbound_url
from ..plugins import registry
from ..plugins.manifest import EVENTS, SCOPES, Manifest
from ..schemas.base import CamelModel, iso
from ..services import agents as agent_service
from ..services import audit as audit_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/plugins")


class PluginOut(CamelModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    runtime: str
    status: str
    version: str
    request_url: str | None = None
    events: list[str]
    scopes: list[str]
    bot_user_id: str | None = None
    last_error: str | None = None
    created_at: str
    updated_at: str
    #: Queued and failed counts, so a broken app is visible without reading logs.
    pending_deliveries: int = 0
    failed_deliveries: int = 0


class PluginsOut(CamelModel):
    plugins: list[PluginOut]


class CatalogOut(CamelModel):
    """What an app may ask for. Drives the consent screen."""

    scopes: dict[str, str]
    events: dict[str, str]


class InstalledOut(CamelModel):
    plugin: PluginOut
    #: Shown once. Not recoverable — rotate to get a new one.
    signing_secret: str
    bot_token: str


class RepoInput(CamelModel):
    repo_url: str = Field(min_length=1, max_length=300)
    ref: str = Field(default="main", min_length=1, max_length=100)


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


class DeliveryOut(CamelModel):
    id: str
    event: str
    status: str
    attempts: int
    last_status_code: int | None = None
    last_error: str | None = None
    created_at: str
    delivered_at: str | None = None


class DeliveriesOut(CamelModel):
    deliveries: list[DeliveryOut]


class TokenOut(CamelModel):
    bot_token: str


class SecretOut(CamelModel):
    signing_secret: str


class OkOut(CamelModel):
    ok: bool = True


async def _to_plugin(session: Any, row: Any) -> PluginOut:
    scopes = await registry.granted_scopes(session, row.id)
    counts = (
        await session.execute(
            text(
                """
                SELECT
                  count(*) FILTER (WHERE status = 'pending') AS pending,
                  count(*) FILTER (WHERE status IN ('failed', 'dead')) AS failed
                  FROM plugin_deliveries WHERE plugin_id = :id
                """
            ),
            {"id": row.id},
        )
    ).fetchone()
    bot_id = await registry.bot_user_id(session, row.id)
    return PluginOut(
        id=row.id,
        slug=row.slug,
        name=row.name,
        description=row.description,
        runtime=row.runtime,
        status=row.status,
        version=row.version,
        request_url=row.request_url,
        events=list(row.events or []),
        scopes=scopes,
        bot_user_id=bot_id,
        last_error=row.last_error,
        created_at=iso(row.created_at),
        updated_at=iso(row.updated_at),
        pending_deliveries=int(counts.pending if counts else 0),
        failed_deliveries=int(counts.failed if counts else 0),
    )


@router.get("/catalog", response_model=CatalogOut)
async def catalog(_admin: SessionUser = Depends(require_admin)) -> CatalogOut:
    return CatalogOut(scopes=SCOPES, events=EVENTS)


@router.get("", response_model=PluginsOut)
async def list_plugins(admin: SessionUser = Depends(require_admin)) -> PluginsOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT * FROM plugins WHERE workspace_id = :ws ORDER BY name"),
                {"ws": admin.workspace_id},
            )
        ).fetchall()
        return PluginsOut(plugins=[await _to_plugin(session, row) for row in rows])


@router.post("", response_model=InstalledOut, status_code=201)
async def install_plugin(
    manifest: Manifest, request: Request, admin: SessionUser = Depends(require_admin)
) -> InstalledOut:
    if manifest.runtime == "container":
        raise bad_request(
            "An agent hosted from a repository is installed with its repository URL, "
            "not a manifest — POST /api/admin/plugins/from-repo.",
            code="use_from_repo",
        )
    if manifest.runtime != "external":
        raise bad_request(
            "Local plugins are installed on the filesystem and loaded at boot, not "
            "through the console — installing one is equivalent to deploying code.",
            code="local_not_installable",
        )
    await _assert_reachable(manifest.request_url)

    async with transaction() as (session, _after):
        installed = await registry.install(
            session,
            workspace_id=admin.workspace_id,
            manifest=manifest,
            installed_by=admin.id,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.installed",
            target_type="plugin",
            target_id=installed.plugin_id,
            metadata={
                "slug": manifest.slug,
                "name": manifest.name,
                "scopes": sorted(set(manifest.scopes)),
                "events": sorted(set(manifest.events)),
            },
        )
        row = await registry.by_id(session, installed.plugin_id, admin.workspace_id)
        plugin = await _to_plugin(session, row)

    return InstalledOut(
        plugin=plugin,
        signing_secret=installed.signing_secret,
        bot_token=installed.bot_token,
    )


async def _assert_reachable(url: str | None) -> None:
    """Refuse a request URL the server should not be made to fetch.

    HTTPS is required because a delivery carries workspace content and a signature; over
    plain HTTP both are readable by anything on the path. The private-range check is the
    real one: without it, registering an app is a way to make the server issue requests
    against its own network — the database, Redis, or a cloud metadata endpoint.
    """
    if not url:
        raise bad_request("An external app needs a request URL.", code="url_required")
    reason = await check_outbound_url(url, require_https=True)
    if reason:
        raise bad_request(reason, code="bad_request_url")


@router.put("/{plugin_id}", response_model=PluginOut)
async def update_plugin(
    plugin_id: str,
    manifest: Manifest,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    await _assert_reachable(manifest.request_url)
    async with transaction() as (session, _after):
        widened = await registry.update(
            session,
            plugin_id=plugin_id,
            workspace_id=admin.workspace_id,
            manifest=manifest,
            actor_id=admin.id,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.updated",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"version": manifest.version, "newScopes": widened},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/approve", response_model=PluginOut)
async def approve_plugin(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> PluginOut:
    """Accept the wider permissions an update asked for."""
    async with transaction() as (session, _after):
        await registry.approve(session, plugin_id, admin.workspace_id)
        scopes = await registry.granted_scopes(session, plugin_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.approved",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"scopes": scopes},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/enabled", response_model=PluginOut)
async def set_enabled(
    plugin_id: str,
    payload: dict[str, bool],
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    enabled = bool(payload.get("enabled", True))
    async with transaction() as (session, _after):
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)
        if enabled and existing.status == "needs_review":
            raise bad_request(
                "That app is waiting for its new permissions to be approved.",
                code="needs_review",
            )
        await registry.set_status(
            session, plugin_id, admin.workspace_id, "enabled" if enabled else "disabled"
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.enabled" if enabled else "plugin.disabled",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"slug": existing.slug},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/secret", response_model=SecretOut)
async def rotate_secret(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> SecretOut:
    async with transaction() as (session, _after):
        secret = await registry.rotate_secret(session, plugin_id, admin.workspace_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.secret_rotated",
            target_type="plugin",
            target_id=plugin_id,
        )
    return SecretOut(signing_secret=secret)


@router.post("/{plugin_id}/token", response_model=TokenOut)
async def issue_token(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> TokenOut:
    """Mint a fresh bot token. Existing ones keep working until revoked."""
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        token = await registry.mint_token(session, plugin_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.token_issued",
            target_type="plugin",
            target_id=plugin_id,
        )
    return TokenOut(bot_token=token)


@router.delete("/{plugin_id}/tokens", response_model=OkOut)
async def revoke_tokens(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        await session.execute(
            text(
                """
                UPDATE bot_tokens SET revoked_at = now()
                 WHERE plugin_id = :id AND revoked_at IS NULL
                """
            ),
            {"id": plugin_id},
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.tokens_revoked",
            target_type="plugin",
            target_id=plugin_id,
        )
    return OkOut()


@router.get("/{plugin_id}/deliveries", response_model=DeliveriesOut)
async def list_deliveries(
    plugin_id: str,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    admin: SessionUser = Depends(require_admin),
) -> DeliveriesOut:
    """The delivery log — the first place to look when an app says it heard nothing."""
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, event, status, attempts, last_status_code, last_error,
                           created_at, delivered_at
                      FROM plugin_deliveries
                     WHERE plugin_id = :id
                     ORDER BY id DESC
                     LIMIT :limit
                    """
                ),
                {"id": plugin_id, "limit": limit},
            )
        ).fetchall()
    return DeliveriesOut(
        deliveries=[
            DeliveryOut(
                id=row.id,
                event=row.event,
                status=row.status,
                attempts=row.attempts,
                last_status_code=row.last_status_code,
                last_error=row.last_error,
                created_at=iso(row.created_at),
                delivered_at=iso(row.delivered_at) if row.delivered_at else None,
            )
            for row in rows
        ]
    )


@router.delete("/{plugin_id}", response_model=OkOut)
async def uninstall_plugin(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _after):
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)
        await registry.uninstall(session, plugin_id, admin.workspace_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.uninstalled",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"slug": existing.slug, "name": existing.name},
        )
    return OkOut()


# ─── agents hosted from a repository ──────────────────────────────────────────
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
    installed, _source = await agent_service.install_from_repo(
        actor_for(request, admin), payload.repo_url, payload.ref, settings.PUBLIC_URL
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
    return DeploymentOut(
        deployment_id=deployment.id, status=deployment.status, url=deployment.url
    )


@router.post("/{plugin_id}/redeploy", response_model=DeploymentOut)
async def redeploy(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> DeploymentOut:
    deployment = await agent_service.redeploy(actor_for(request, admin), plugin_id)
    return DeploymentOut(
        deployment_id=deployment.id, status=deployment.status, url=deployment.url
    )


@router.post("/{plugin_id}/stop", response_model=OkOut)
async def stop_agent(
    plugin_id: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    await agent_service.stop(actor_for(request, admin), plugin_id)
    return OkOut()


__all__ = ["router"]
