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

from collections.abc import Sequence
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib import net
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import bad_request, not_found
from ..lib.ids import IdParam
from ..plugins import gateway, registry
from ..plugins.manifest import EVENTS, SCOPES, Manifest
from ..schemas.base import CamelModel, iso, require_iso
from ..services import agent_runs as agent_run_service
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
    #: The subset of `scopes` still awaiting a person's approval — what the consent
    #: screen lists. Non-empty exactly while the app is parked in `needs_review`.
    pending_scopes: list[str] = []
    bot_user_id: str | None = None
    #: Whose agent this is, or None for the workspace's own. Decides who may command it:
    #: an unowned agent answers everybody, an owned one answers its owner and whoever
    #: they have lent it to.
    owner_user_id: str | None = None
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
    #: Daily caps and what the trailing day actually cost, so the meter and the dial sit
    #: on the same row of the console. None means uncapped.
    budget_runs_per_day: int | None = None
    budget_seconds_per_day: int | None = None
    runs_last_day: int = 0
    seconds_last_day: int = 0


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
    return (await _to_plugins(session, [row]))[0]


async def _to_plugins(session: Any, rows: Sequence[Any]) -> list[PluginOut]:
    """Batch shape: three grouped queries however many plugins there are.

    The per-row version made the console's plugin list a 3N+1 — scopes, delivery
    counts and the bot row each round-tripped per plugin, so ten apps cost thirty-one
    queries to render one page.
    """
    ids = [str(row.id) for row in rows]
    if not ids:
        return []

    scope_rows = (
        await session.execute(
            text(
                """
                SELECT plugin_id, scope FROM plugin_grants
                 WHERE plugin_id = ANY(cast(:ids AS uuid[])) ORDER BY scope
                """
            ),
            {"ids": ids},
        )
    ).fetchall()
    scopes_by: dict[str, list[str]] = {}
    for entry in scope_rows:
        scopes_by.setdefault(str(entry.plugin_id), []).append(entry.scope)

    count_rows = (
        await session.execute(
            text(
                """
                SELECT plugin_id,
                       count(*) FILTER (WHERE status = 'pending') AS pending,
                       count(*) FILTER (WHERE status IN ('failed', 'dead')) AS failed
                  FROM plugin_deliveries
                 WHERE plugin_id = ANY(cast(:ids AS uuid[]))
                 GROUP BY plugin_id
                """
            ),
            {"ids": ids},
        )
    ).fetchall()
    counts_by = {str(entry.plugin_id): entry for entry in count_rows}

    bot_rows = (
        await session.execute(
            text(
                "SELECT id, bot_plugin_id FROM users"
                " WHERE bot_plugin_id = ANY(cast(:ids AS uuid[]))"
            ),
            {"ids": ids},
        )
    ).fetchall()
    bots_by = {str(entry.bot_plugin_id): str(entry.id) for entry in bot_rows}

    usage_by = await agent_run_service.usage_by_plugin(session, ids)

    return [
        await _build_plugin(
            row,
            scopes=scopes_by.get(str(row.id), []),
            counts=counts_by.get(str(row.id)),
            bot_id=bots_by.get(str(row.id)),
            usage=usage_by.get(str(row.id)),
        )
        for row in rows
    ]


async def _build_plugin(
    row: Any,
    *,
    scopes: list[str],
    counts: Any,
    bot_id: str | None,
    usage: tuple[int, int] | None = None,
) -> PluginOut:
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
        pending_scopes=list(getattr(row, "pending_scopes", None) or []),
        bot_user_id=bot_id,
        owner_user_id=getattr(row, "owner_user_id", None),
        last_error=row.last_error,
        created_at=iso(row.created_at),
        updated_at=iso(row.updated_at),
        pending_deliveries=int(counts.pending if counts else 0),
        failed_deliveries=int(counts.failed if counts else 0),
        budget_runs_per_day=getattr(row, "budget_runs_per_day", None),
        budget_seconds_per_day=getattr(row, "budget_seconds_per_day", None),
        runs_last_day=usage[0] if usage else 0,
        seconds_last_day=usage[1] if usage else 0,
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
        return PluginsOut(plugins=await _to_plugins(session, rows))


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
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise bad_request("The URL must start with https://.", code="bad_request_url")
    if not parsed.hostname:
        raise bad_request("The URL needs a hostname.", code="bad_request_url")
    if await net.is_private_host(parsed.hostname):
        # A private address here is not a malformed URL — it is the thing the server
        # administrator turned off. The client branches on the code, and telling an
        # admin "that is not a valid URL" about a URL that is perfectly valid sent
        # them to the wrong fix.
        raise policy_service.refuse_private_endpoint()


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


class AgentOwnerInput(CamelModel):
    #: Whose agent this is, or null to hand it back to the workspace.
    user_id: str | None = None


@router.put("/{plugin_id}/owner", response_model=OkOut)
async def set_agent_owner(
    plugin_id: IdParam,
    payload: AgentOwnerInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    """Give an agent to a person, or hand it back to the workspace.

    Ownership is Blob's fact about an install, not something the app declares — an app
    cannot name its own owner any more than it can grant itself a scope — so it is its own
    route rather than a field on the manifest.

    Owned means it answers that person and whoever they lend it to. Unowned means it
    answers everybody, which is what the workspace's own assistant should do.
    """
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        if payload.user_id is not None:
            member = (
                await session.execute(
                    text(
                        """
                        SELECT id FROM users
                         WHERE id = :id AND workspace_id = :ws
                           AND deactivated_at IS NULL AND kind = 'human'
                        """
                    ),
                    {"id": payload.user_id, "ws": admin.workspace_id},
                )
            ).fetchone()
            if member is None:
                raise bad_request("That person is not in this workspace.")

        await session.execute(
            text("UPDATE plugins SET owner_user_id = :owner WHERE id = :id AND workspace_id = :ws"),
            {"owner": payload.user_id, "id": plugin_id, "ws": admin.workspace_id},
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.owner_changed",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"ownerUserId": payload.user_id},
        )
    return OkOut()


@router.put("/{plugin_id}", response_model=PluginOut)
async def update_plugin(
    plugin_id: IdParam,
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
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> PluginOut:
    """Accept the wider permissions an update asked for."""
    async with transaction() as (session, _after):
        accepted = await registry.approve(session, plugin_id, admin.workspace_id)
        scopes = await registry.granted_scopes(session, plugin_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.approved",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"scopes": scopes, "newScopes": accepted},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/decline", response_model=PluginOut)
async def decline_plugin_scopes(
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> PluginOut:
    """Refuse the wider permissions an update asked for; the app keeps what it had.

    The other half of the consent screen. Without it, "no" could only be spelled
    disable or uninstall — both outages, neither an answer about permissions.
    """
    async with transaction() as (session, _after):
        declined = await registry.decline_scopes(session, plugin_id, admin.workspace_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.scopes_declined",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"scopes": declined},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/enabled", response_model=PluginOut)
async def set_enabled(
    plugin_id: IdParam,
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


class BudgetInput(CamelModel):
    """Daily caps. None lifts one; both None means unlimited, which is the default."""

    runs_per_day: int | None = None
    seconds_per_day: int | None = None


@router.post("/{plugin_id}/budget", response_model=PluginOut)
async def set_budget(
    plugin_id: IdParam,
    payload: BudgetInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    """Cap what an agent may spend in a trailing day — runs begun and seconds occupied.

    Measured in what Blob observes rather than tokens, which belong to the agent's own
    provider. A capped agent's next mention gets a refused run card in the channel, not
    silence, so hitting the ceiling is visible where the mention happened.
    """
    for name, value in (
        ("runsPerDay", payload.runs_per_day),
        ("secondsPerDay", payload.seconds_per_day),
    ):
        if value is not None and not 1 <= value <= 1_000_000:
            raise bad_request(
                f"{name} must be between 1 and 1000000, or null.", code="invalid_input"
            )
    async with transaction() as (session, _after):
        await registry.set_budget(
            session,
            plugin_id,
            admin.workspace_id,
            runs_per_day=payload.runs_per_day,
            seconds_per_day=payload.seconds_per_day,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.budget_set",
            target_type="plugin",
            target_id=plugin_id,
            metadata={
                "runsPerDay": payload.runs_per_day,
                "secondsPerDay": payload.seconds_per_day,
            },
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


@router.post("/{plugin_id}/secret", response_model=SecretOut)
async def rotate_secret(
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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
    thread_root_id: IdParam | None = None
    trigger_message_id: IdParam | None = None
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
    plugin_id: IdParam,
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
    plugin_id: IdParam,
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
    plugin_id: IdParam,
    delivery_id: IdParam,
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
    plugin_id: IdParam, admin: SessionUser = Depends(require_admin)
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
    plugin_id: IdParam,
    channel_id: IdParam,
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
    plugin_id: IdParam,
    channel_id: IdParam,
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
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
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


__all__ = ["router"]
