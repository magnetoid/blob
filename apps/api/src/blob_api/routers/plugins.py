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

from collections import Counter
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import Field
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import AppError, bad_request, not_found
from ..lib.net import check_outbound_url
from ..plugins import gateway, registry, runner
from ..plugins.env import RESERVED_NAMES as RESERVED_ENV_NAMES
from ..plugins.env import RESERVED_PREFIX, validate_env
from ..plugins.manifest import EVENTS, SCOPES, Manifest
from ..schemas.base import CamelModel, iso, require_iso
from ..services import agent_runs as agent_run_service
from ..services import agents as agent_service
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import commands as command_service
from ..services import policies as policy_service
from ..services.audit import actor_for
from ..tools import agent_bridge

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
    #: Set when the app answers over AG-UI instead of (or beside) a webhook.
    agui_url: str | None = None
    events: list[str]
    scopes: list[str]
    bot_user_id: str | None = None
    last_error: str | None = None
    created_at: str
    updated_at: str
    #: Queued and failed counts, so a broken app is visible without reading logs.
    pending_deliveries: int = 0
    failed_deliveries: int = 0
    #: Set only for an agent deployed from a repository.
    source_repo: str | None = None
    source_ref: str | None = None
    deployment_status: str | None = None
    #: Whether a dial-in agent is holding a connection right now. `None` for every other
    #: runtime, where the question is meaningless and a `false` would read as "broken".
    #:
    #: Until this existed there was no way to tell a connected agent from one whose laptop
    #: had closed — the only signal was mentioning it and waiting to see whether anything
    #: happened, and the reply on failure ("that agent is not connected right now") arrives
    #: in a channel rather than in the console where it would be acted on.
    online: bool | None = None


class AppChannel(CamelModel):
    id: str
    name: str | None = None
    kind: str
    #: Whether this app's bot is currently a member.
    joined: bool


class AppChannelsOut(CamelModel):
    channels: list[AppChannel]


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


class DeliveryOut(CamelModel):
    id: str
    event: str
    status: str
    attempts: int
    last_status_code: int | None = None
    last_error: str | None = None
    created_at: str
    delivered_at: str | None = None
    #: Only meaningful while a delivery is still pending. On a delivered or dead row the
    #: column holds whatever the last lease stamped, which reads as a retry that is never
    #: going to happen.
    next_attempt_at: str | None = None


class DeliveriesOut(CamelModel):
    deliveries: list[DeliveryOut]


class DeliveryDetailOut(DeliveryOut):
    """One delivery, with the body the app was sent.

    Kept off the list on purpose: 200 payloads is a lot of JSON to send someone who is
    looking for which delivery failed, and the answer to "what did it actually receive"
    is only ever asked about one row at a time.
    """

    payload: dict[str, Any]


class TokenOut(CamelModel):
    bot_token: str


class SecretOut(CamelModel):
    signing_secret: str


class OkOut(CamelModel):
    ok: bool = True


def _to_delivery(row: Any) -> DeliveryOut:
    return DeliveryOut(
        id=row.id,
        event=row.event,
        status=row.status,
        attempts=row.attempts,
        last_status_code=row.last_status_code,
        last_error=row.last_error,
        created_at=iso(row.created_at),
        delivered_at=iso(row.delivered_at) if row.delivered_at else None,
        next_attempt_at=(
            iso(row.next_attempt_at) if row.status == "pending" and row.next_attempt_at else None
        ),
    )


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
        source_repo=getattr(row, "source_repo", None),
        source_ref=getattr(row, "source_ref", None),
        deployment_status=getattr(row, "deployment_status", None),
        request_url=row.request_url,
        agui_url=getattr(row, "agui_url", None),
        # Asked across the whole cluster, not of this process: the socket is held by
        # whichever API process the agent happened to dial, and `gateway.live_connections`
        # only ever knew about this one. The Redis presence key is the shared answer.
        online=await gateway.is_online(row.id) if row.runtime == "socket" else None,
        events=list(row.events or []),
        scopes=scopes,
        bot_user_id=bot_id,
        last_error=row.last_error,
        created_at=iso(row.created_at),
        updated_at=iso(row.updated_at),
        pending_deliveries=int(counts.pending if counts else 0),
        failed_deliveries=int(counts.failed if counts else 0),
    )


@router.get("/bridge", response_class=PlainTextResponse)
async def agent_bridge_source(_admin: SessionUser = Depends(require_admin)) -> str:
    """The bridge script, so a desktop agent can be connected with two commands.

    A socket agent needs a client holding the connection, and `tools/agent_bridge.py` is
    it — but telling someone to clone this repo onto a laptop to run one file is a setup
    step most people abandon. The file already ships inside the image, so serving it is
    the difference between "install Blob on your desktop" and `curl`.

    Read from disk on each request rather than cached: it is a few kilobytes, this is an
    admin route nobody hits in a loop, and a stale copy served after an upgrade would be
    a bridge speaking a protocol the server has moved past.

    Admin-only, because it is served alongside the tokens it is used with — not because
    the source is a secret. It is in a public repository.
    """
    source = Path(agent_bridge.__file__)
    try:
        return source.read_text(encoding="utf-8")
    except OSError as error:  # pragma: no cover — only if the image is broken
        raise not_found("The bridge script is not available on this server.") from error


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
    if manifest.runtime == "local":
        raise bad_request(
            "Local plugins are installed on the filesystem and loaded at boot, not "
            "through the console — installing one is equivalent to deploying code.",
            code="local_not_installable",
        )
    async with session_scope() as session:
        policy = await policy_service.effective_for(session, admin.workspace_id)
        await _assert_within_policy(session, admin.workspace_id, policy, manifest.scopes)
    if manifest.runtime == "socket" and not policy.may_connect_socket_agents:
        raise policy_service.refuse_socket_agent()

    if manifest.runtime == "socket":
        # A socket agent is registered before it exists anywhere: this call mints the
        # token, and the agent becomes real when it dials in with it. There is nothing to
        # reach, and declaring a URL alongside would leave two answers to "where is it".
        if manifest.request_url or manifest.agui_url:
            raise bad_request(
                "An agent that connects to Blob does not declare a URL — it dials in "
                "with its token.",
                code="url_not_allowed",
            )
    else:
        await _assert_reachable(manifest.request_url, policy)
        await _assert_reachable(manifest.agui_url, policy)

    async with transaction() as (session, _after):
        installed = await registry.install(
            session,
            workspace_id=admin.workspace_id,
            manifest=manifest,
            installed_by=admin.id,
            reserved_commands=command_service.builtin_names(),
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


async def _assert_reachable(url: str | None, policy: policy_service.Policy) -> None:
    """Refuse a request URL the server should not be made to fetch.

    HTTPS is required because a delivery carries workspace content and a signature; over
    plain HTTP both are readable by anything on the path. The private-range check is the
    real one: without it, registering an app is a way to make the server issue requests
    against its own network — the database, Redis, or a cloud metadata endpoint.
    """
    # Absent is not this function's business any more: an app may declare a webhook URL,
    # an AG-UI URL or both, and `validate_manifest` is what insists on at least one.
    # Keeping the "missing" case here as well made the first of the two checks reject
    # every AG-UI-only app before the second one could look at it.
    if not url:
        return
    if policy.may_use_private_endpoints:
        # The operator has said they own the network this app sits on, *and* that this
        # workspace may reach it. `effective_for` has already combined the two; a policy
        # row can narrow AGENT_ALLOW_PRIVATE_ENDPOINTS and never widen it. The URL is
        # still parsed — a malformed one is a mistake at any setting — but not judged.
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise bad_request("That is not a valid URL.", code="bad_request_url")
        return
    reason = await check_outbound_url(url, require_https=True)
    if reason:
        raise bad_request(reason, code="bad_request_url")


def _assert_scopes_allowed(policy: policy_service.Policy, scopes: list[str]) -> None:
    blocked = sorted(set(scopes) & policy.denied_scopes)
    if blocked:
        raise policy_service.refuse_scopes(blocked)


async def _assert_within_policy(
    session: Any,
    workspace_id: str,
    policy: policy_service.Policy,
    scopes: list[str],
) -> None:
    """Everything an install has to satisfy that is not about the manifest being valid."""
    _assert_scopes_allowed(policy, scopes)
    if policy.max_apps is not None:
        if await policy_service.app_count(session, workspace_id) >= policy.max_apps:
            raise policy_service.refuse_app_limit(policy.max_apps)


@router.put("/{plugin_id}", response_model=PluginOut)
async def update_plugin(
    plugin_id: str,
    manifest: Manifest,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    async with session_scope() as session:
        policy = await policy_service.effective_for(session, admin.workspace_id)
        # Not the app count: an update does not add one, and refusing to *edit* an app
        # because the workspace is at its limit would strand it at whatever it was.
        _assert_scopes_allowed(policy, manifest.scopes)
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)

    # The same two guards `install_plugin` applies, which this route did not. `runtime` is
    # immutable — `registry.update` does not write it — so the runtime that matters is the
    # stored one, not whatever the body claims. Without this an admin could PUT a URL onto
    # a socket agent, leaving a row that answers "where is it?" twice, and a workspace
    # whose socket capability had been revoked could still edit its socket agents.
    if existing.runtime == "socket":
        if not policy.may_connect_socket_agents:
            raise policy_service.refuse_socket_agent()
        if manifest.request_url or manifest.agui_url:
            raise bad_request(
                "An agent that connects to Blob does not declare a URL — it dials in "
                "with its token.",
                code="url_not_allowed",
            )

    await _assert_reachable(manifest.request_url, policy)
    await _assert_reachable(manifest.agui_url, policy)
    async with transaction() as (session, _after):
        widened = await registry.update(
            session,
            plugin_id=plugin_id,
            workspace_id=admin.workspace_id,
            manifest=manifest,
            actor_id=admin.id,
            reserved_commands=command_service.builtin_names(),
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


class AgentRunOut(CamelModel):
    id: str
    channel_id: str
    channel_name: str | None = None
    thread_root_id: str | None = None
    trigger_message_id: str | None = None
    trigger_user_name: str | None = None
    transport: str
    status: str
    error: str | None = None
    post_count: int
    started_at: str
    finished_at: str | None = None
    #: Milliseconds, computed here so the console does not do date arithmetic to show
    #: the one number that says whether an agent is slow.
    duration_ms: int | None = None


class AgentRunsOut(CamelModel):
    runs: list[AgentRunOut]


@router.get("/{plugin_id}/runs", response_model=AgentRunsOut)
async def list_runs(
    plugin_id: str,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    admin: SessionUser = Depends(require_admin),
) -> AgentRunsOut:
    """What happened the last few times this agent was asked something.

    The delivery log answers "did the app hear us"; this answers "did it manage to
    reply, and if not why". Before it existed the only record was `plugins.last_error`,
    which the next failure overwrote — so a run that failed, one that finished quietly
    and said nothing, and one that never started were indistinguishable.
    """
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        runs = await agent_run_service.list_for_plugin(
            session, admin.workspace_id, plugin_id, limit=limit
        )
    return AgentRunsOut(
        runs=[
            AgentRunOut(
                id=run.id,
                channel_id=run.channel_id,
                channel_name=run.channel_name,
                thread_root_id=run.thread_root_id,
                trigger_message_id=run.trigger_message_id,
                trigger_user_name=run.trigger_user_name,
                transport=run.transport,
                status=run.status,
                error=run.error,
                post_count=run.post_count,
                started_at=require_iso(run.started_at),
                finished_at=iso(run.finished_at),
                duration_ms=(
                    int((run.finished_at - run.started_at).total_seconds() * 1000)
                    if run.finished_at
                    else None
                ),
            )
            for run in runs
        ]
    )


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
                           created_at, delivered_at, next_attempt_at
                      FROM plugin_deliveries
                     WHERE plugin_id = :id
                     ORDER BY id DESC
                     LIMIT :limit
                    """
                ),
                {"id": plugin_id, "limit": limit},
            )
        ).fetchall()
    return DeliveriesOut(deliveries=[_to_delivery(row) for row in rows])


@router.get("/{plugin_id}/deliveries/{delivery_id}", response_model=DeliveryDetailOut)
async def read_delivery(
    plugin_id: str,
    delivery_id: str,
    admin: SessionUser = Depends(require_admin),
) -> DeliveryDetailOut:
    """One delivery in full, including the payload the app was sent."""
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, event, status, attempts, last_status_code, last_error,
                           created_at, delivered_at, next_attempt_at, payload
                      FROM plugin_deliveries
                     WHERE id = :id AND plugin_id = :plugin_id
                    """
                ),
                {"id": delivery_id, "plugin_id": plugin_id},
            )
        ).fetchone()
    if row is None:
        raise not_found("That delivery is not in this app's log.")
    return DeliveryDetailOut(**_to_delivery(row).model_dump(), payload=row.payload)


@router.get("/{plugin_id}/channels", response_model=AppChannelsOut)
async def app_channels(
    plugin_id: str, admin: SessionUser = Depends(require_admin)
) -> AppChannelsOut:
    """Where this app can speak, and where it could.

    An installed app is inert until its bot joins a channel, and until now nothing in
    the console said so or offered to fix it — the only route in was the bot calling
    `conversations.join` on its own behalf, which an app that has not been written yet
    cannot do. That is the gap this closes.

    Private channels and DMs are not listed. A bot belongs in one only if somebody in it
    invited it, and enumerating them here would hand an admin a directory of private
    rooms they are not in.
    """
    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, admin.workspace_id)
        bot_id = await registry.bot_user_id(session, plugin.id)
        rows = (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.name, c.kind,
                           EXISTS (
                             SELECT 1 FROM channel_members cm
                              WHERE cm.channel_id = c.id AND cm.user_id = :bot
                           ) AS joined
                      FROM channels c
                     WHERE c.workspace_id = :ws
                       AND c.kind = 'public'
                       AND c.archived_at IS NULL
                     ORDER BY c.name ASC
                    """
                ),
                {"ws": admin.workspace_id, "bot": bot_id},
            )
        ).fetchall()
    return AppChannelsOut(
        channels=[
            AppChannel(id=row.id, name=row.name, kind=row.kind, joined=bool(row.joined))
            for row in rows
        ]
    )


@router.post("/{plugin_id}/channels/{channel_id}", response_model=OkOut)
async def app_join_channel(
    plugin_id: str,
    channel_id: str,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    async with transaction() as (session, _after):
        plugin = await registry.by_id(session, plugin_id, admin.workspace_id)
        bot_id = await registry.bot_user_id(session, plugin.id)
        if not bot_id:
            raise bad_request("That app has no bot to add.", code="no_bot")
        # The admin's own access decides this, not the bot's: adding a bot somewhere you
        # cannot see would be a way to read a channel you were not in.
        await channel_service.assert_channel_access(session, admin.id, channel_id)
        await channel_service.join(session, channel_id, bot_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.channel_joined",
            target_type="channel",
            target_id=channel_id,
            metadata={"pluginId": plugin_id, "slug": plugin.slug},
        )
    return OkOut()


@router.delete("/{plugin_id}/channels/{channel_id}", response_model=OkOut)
async def app_leave_channel(
    plugin_id: str,
    channel_id: str,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    async with transaction() as (session, _after):
        plugin = await registry.by_id(session, plugin_id, admin.workspace_id)
        bot_id = await registry.bot_user_id(session, plugin.id)
        if not bot_id:
            raise bad_request("That app has no bot to remove.", code="no_bot")
        await channel_service.assert_channel_access(session, admin.id, channel_id)
        await channel_service.leave(session, channel_id, bot_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.channel_left",
            target_type="channel",
            target_id=channel_id,
            metadata={"pluginId": plugin_id, "slug": plugin.slug},
        )
    return OkOut()


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
