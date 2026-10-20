"""The MCP servers page: servers an admin connects, and what agents may use of them.

ADR 0027. Shapes and authorizes; `services/mcp_servers.py` decides, and `plugins/
mcp_client.py` talks to the servers. Every route is a workspace admin's. A server is
listed before it is kept, so adding one that cannot answer is refused with the reason —
outside any transaction, since a server may take seconds — and a secret header goes in
and never comes back out.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from ..db.engine import transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.ids import IdParam
from ..schemas.base import CamelModel, OkOut, iso, require_iso
from ..services import audit as audit_service
from ..services import mcp_servers
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/mcp-servers")

Policy = Literal["off", "ask", "auto_in_dm", "auto_everywhere"]


class McpToolOut(CamelModel):
    name: str
    title: str | None
    description: str
    #: What the server says of it. It set the starting policy and nothing else.
    read_only: bool
    policy: Policy


class McpServerOut(CamelModel):
    id: str
    name: str
    #: The prefix of its tools' names as agents see them: `<slug>__<tool>`.
    slug: str
    url: str
    enabled: bool
    auth: Literal["none", "bearer", "header"]
    #: The header's name when `auth` is `header`. A secret's value is never sent back.
    auth_header: str | None
    era: Literal["modern", "legacy"] | None
    protocol_version: str | None
    server_name: str | None
    server_version: str | None
    checked_at: str | None
    last_error: str | None
    last_error_at: str | None
    created_at: str
    tools: list[McpToolOut]
    agent_ids: list[str]
    #: Tools the server listed that Blob left out, each with why. Only on the answer to
    #: the request that listed them.
    skipped: list[str] = []


class McpServersOut(CamelModel):
    servers: list[McpServerOut]


class McpAuthIn(CamelModel):
    kind: Literal["none", "bearer", "header"] = "none"
    #: The token, or the header's value. Write-only.
    value: str | None = Field(default=None, max_length=mcp_servers.SECRET_MAX)
    header: str | None = Field(default=None, max_length=100)


class McpServerIn(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=mcp_servers.URL_MAX)
    auth: McpAuthIn = McpAuthIn()


class McpServerPatch(CamelModel):
    name: str | None = Field(default=None, max_length=200)
    url: str | None = Field(default=None, max_length=mcp_servers.URL_MAX)
    #: A new credential. Absent keeps the one it has.
    auth: McpAuthIn | None = None
    enabled: bool | None = None


class McpToolPolicyIn(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    policy: Policy


def _auth(raw: McpAuthIn) -> mcp_servers.Auth:
    return mcp_servers.Auth(kind=raw.kind, value=raw.value, header=raw.header)


def _out(view: mcp_servers.ServerView, skipped: list[str] | None = None) -> McpServerOut:
    return McpServerOut(
        id=view.id,
        name=view.name,
        slug=view.slug,
        url=view.url,
        enabled=view.enabled,
        auth=view.auth,
        auth_header=view.auth_header,
        era=view.era if view.era in ("modern", "legacy") else None,
        protocol_version=view.protocol_version,
        server_name=view.server_name,
        server_version=view.server_version,
        checked_at=iso(view.checked_at),
        last_error=view.last_error,
        last_error_at=iso(view.last_error_at),
        created_at=require_iso(view.created_at),
        tools=[
            McpToolOut(
                name=tool.name,
                title=tool.title,
                description=tool.description,
                read_only=tool.read_only,
                policy=tool.policy,
            )
            for tool in view.tools
        ],
        agent_ids=view.agent_ids,
        skipped=skipped or [],
    )


@router.get("", response_model=McpServersOut)
async def list_servers(admin: SessionUser = Depends(require_admin)) -> McpServersOut:
    """Every server connected here, with its tools, their policies and who may use them."""
    async with transaction() as (session, _after):
        views = await mcp_servers.views(session, admin.workspace_id)
    return McpServersOut(servers=[_out(view) for view in views])


@router.post("", response_model=McpServerOut, status_code=201)
async def add_server(
    payload: McpServerIn, request: Request, admin: SessionUser = Depends(require_admin)
) -> McpServerOut:
    """Connect a server. It is asked for its tools first; one that cannot answer is not
    added, and the answer says why. Its tools start at their default policies and no agent
    may use them until it is granted the server."""
    prepared = await mcp_servers.prepare(
        admin.workspace_id, name=payload.name, url=payload.url, auth=_auth(payload.auth)
    )
    async with transaction() as (session, _after):
        server_id = await mcp_servers.insert(session, admin.workspace_id, prepared, by=admin.id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.added",
            target_type="mcp_server",
            target_id=server_id,
            metadata={
                "name": prepared.name,
                "url": prepared.url,
                "auth": payload.auth.kind,
                "tools": len(prepared.listing.tools),
            },
        )
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view, prepared.listing.skipped)


@router.patch("/{server_id}", response_model=McpServerOut)
async def change_server(
    server_id: IdParam,
    payload: McpServerPatch,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> McpServerOut:
    """Rename it, switch it off or on, or give it a new address or credential — which is
    checked by listing it again, as a new server is."""
    auth = _auth(payload.auth) if payload.auth is not None else None
    prepared = await mcp_servers.change(
        admin.workspace_id,
        server_id,
        name=payload.name,
        url=payload.url,
        auth=auth,
        enabled=payload.enabled,
    )
    async with transaction() as (session, _after):
        await mcp_servers.apply_change(
            session,
            admin.workspace_id,
            server_id,
            name=payload.name,
            enabled=payload.enabled,
            prepared=prepared,
        )
        changed = [
            field
            for field, value in (
                ("name", payload.name),
                ("url", payload.url),
                ("auth", payload.auth),
                ("enabled", payload.enabled),
            )
            if value is not None
        ]
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.changed",
            target_type="mcp_server",
            target_id=server_id,
            metadata={"changed": changed, "enabled": payload.enabled},
        )
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view, prepared.listing.skipped if prepared is not None else None)


@router.post("/{server_id}/refresh", response_model=McpServerOut)
async def refresh_server(
    server_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> McpServerOut:
    """Ask the server for its tools again. Tools it still has keep their policies."""
    await mcp_servers.refresh(admin.workspace_id, server_id)
    async with transaction() as (session, _after):
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view)


@router.delete("/{server_id}", response_model=OkOut)
async def remove_server(
    server_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Disconnect it. Its tools leave every agent's next run; its credential is deleted."""
    async with transaction() as (session, _after):
        name = await mcp_servers.remove(session, admin.workspace_id, server_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.removed",
            target_type="mcp_server",
            target_id=server_id,
            metadata={"name": name},
        )
    return OkOut()


@router.put("/{server_id}/tools", response_model=McpServerOut)
async def set_tool_policy(
    server_id: IdParam,
    payload: McpToolPolicyIn,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> McpServerOut:
    """Decide whether agents may call one of its tools, and whether a call waits for the
    person who asked. The tool goes in the body: a tool's name may hold a dot or a slash."""
    async with transaction() as (session, _after):
        await mcp_servers.set_policy(
            session, admin.workspace_id, server_id, payload.name, payload.policy
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.tool_policy",
            target_type="mcp_server",
            target_id=server_id,
            metadata={"tool": payload.name, "policy": payload.policy},
        )
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view)


@router.put("/{server_id}/agents/{plugin_id}", response_model=McpServerOut)
async def grant_server(
    server_id: IdParam,
    plugin_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> McpServerOut:
    """Let an agent use this server's tools — and so everyone who may command that agent."""
    async with transaction() as (session, _after):
        await mcp_servers.grant(session, admin.workspace_id, plugin_id, server_id, by=admin.id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.granted",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"serverId": server_id, "pluginId": plugin_id, "granted": True},
        )
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view)


@router.delete("/{server_id}/agents/{plugin_id}", response_model=McpServerOut)
async def revoke_server(
    server_id: IdParam,
    plugin_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> McpServerOut:
    async with transaction() as (session, _after):
        await mcp_servers.revoke(session, admin.workspace_id, plugin_id, server_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "mcp_server.granted",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"serverId": server_id, "pluginId": plugin_id, "granted": False},
        )
        view = await mcp_servers.view(session, admin.workspace_id, server_id)
    return _out(view)


__all__ = ["router"]
