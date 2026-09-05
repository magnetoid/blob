"""A member's own agent.

Every route that installs an agent is an admin's, and that was the whole story while an
agent was the workspace's. Ownership ([[0025]]) made a second kind possible — an agent
that answers one person and whoever they lend it to — and left installing it where it was:
an admin registers it and then hands it over. That is a personal assistant somebody else
had to set up for you.

This is the member's door. A person names an agent; Blob mints the token; the agent on
their laptop dials in with it (ADR 0012) and is theirs from the first mention, because
`owner_user_id` is set in the same transaction that creates it. Nothing about *what* the
agent may do is up to the member: the scopes are the four an answering agent needs and
no more, the workspace policy's `may_connect_socket_agents`, `denied_scopes` and
`max_apps` all still apply, and an admin can still see it, disable it, budget it, or take
it away in the console like any other app.

Everything under `/mine/{id}` answers 404 for an agent that is not the caller's — not 403.
Whose agent something is is the private part, the same way a private channel's existence is.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from pydantic import Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, not_found
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..plugins import gateway, registry
from ..plugins.manifest import Manifest
from ..schemas.base import CamelModel, require_iso
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import commands as command_service
from ..services import policies as policy_service
from ..services.audit import actor_for

router = APIRouter(prefix="/api/agents", tags=["my-agents"])

#: What an agent that answers mentions needs, and nothing beyond it. The member does not
#: pick: a personal agent that could ask for `admin:write` would be an admin's decision
#: being made by a member, and one that could ask for less would answer nothing.
PERSONAL_SCOPES = ("messages:read", "messages:write", "channels:read", "channels:join")

_SLUG_TRIM = re.compile(r"[^a-z0-9]+")


class MyAgentOut(CamelModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    status: str
    #: Whether the agent is holding its connection right now.
    online: bool
    bot_user_id: str | None = None
    created_at: str


class MyAgentsOut(CamelModel):
    agents: list[MyAgentOut]


class AttachInput(CamelModel):
    name: str = Field(min_length=1, max_length=80)


class AttachedOut(CamelModel):
    agent: MyAgentOut
    #: Shown once. The bridge authenticates to Blob with the token and signs each run for
    #: the agent with the secret; the agent verifies the signature.
    bot_token: str
    signing_secret: str


class AgentChannel(CamelModel):
    id: str
    name: str | None = None
    kind: str
    joined: bool


class AgentChannelsOut(CamelModel):
    channels: list[AgentChannel]


class OkOut(CamelModel):
    ok: bool = True


@router.get("/bridge", response_class=PlainTextResponse)
async def bridge_source(_user: SessionUser = Depends(current_user)) -> str:
    """The bridge script, for anybody with an agent to connect.

    The admin console serves the same file at `/api/admin/plugins/bridge`; a member's
    setup screen cannot link there. The script itself holds nothing secret — the token
    and the secret travel in the environment the person sets up beside it.
    """
    path = Path(__file__).resolve().parent.parent / "tools" / "agent_bridge.py"
    return path.read_text(encoding="utf-8")


@router.get("/mine", response_model=MyAgentsOut)
async def list_mine(user: SessionUser = Depends(current_user)) -> MyAgentsOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT p.id, p.slug, p.name, p.description, p.status, p.created_at,
                           u.id AS bot_user_id
                      FROM plugins p
                      LEFT JOIN users u ON u.bot_plugin_id = p.id
                     WHERE p.workspace_id = :ws AND p.owner_user_id = :me
                     ORDER BY p.created_at
                    """
                ),
                {"ws": user.workspace_id, "me": user.id},
            )
        ).fetchall()
    return MyAgentsOut(agents=[await _out(row) for row in rows])


@router.post("/mine", response_model=AttachedOut, status_code=201)
async def attach(
    payload: AttachInput, request: Request, user: SessionUser = Depends(current_user)
) -> AttachedOut:
    """Register an agent that is yours, and get the token it dials in with.

    The agent does not exist yet; it becomes real when something connects with the
    token. Everything the admin route checks for a socket agent is checked here too —
    the same policy, the same scope rules, the same app limit — because this is the same
    install with one column set.
    """
    await consume("agent_attach", user.id)
    name = payload.name.strip()
    base = _SLUG_TRIM.sub("-", name.lower()).strip("-")[:32]
    if len(base) < 3:
        raise bad_request("Give the agent a name of at least three letters or numbers.")

    async with transaction() as (session, _after):
        policy = await policy_service.effective_for(session, user.workspace_id)
        if not policy.may_connect_socket_agents:
            raise policy_service.refuse_socket_agent()
        denied = [scope for scope in PERSONAL_SCOPES if scope in policy.denied_scopes]
        if denied:
            raise policy_service.refuse_scopes(denied)
        if policy.max_apps is not None:
            if await policy_service.app_count(session, user.workspace_id) >= policy.max_apps:
                raise policy_service.refuse_app_limit(policy.max_apps)

        slug = await _free_slug(session, user.workspace_id, base)
        manifest = Manifest(
            slug=slug,
            name=name,
            runtime="socket",
            version="1.0.0",
            events=[],
            scopes=list(PERSONAL_SCOPES),
        )
        installed = await registry.install(
            session,
            workspace_id=user.workspace_id,
            manifest=manifest,
            installed_by=user.id,
            reserved_commands=command_service.builtin_names(),
        )
        # Owned from birth, in the same transaction: there is no moment at which this
        # agent is the workspace's and would answer anyone who happened to mention it.
        await session.execute(
            text("UPDATE plugins SET owner_user_id = :me WHERE id = :id"),
            {"me": user.id, "id": installed.plugin_id},
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.attached",
            target_type="plugin",
            target_id=installed.plugin_id,
            metadata={"slug": slug, "name": name},
        )
        row = await _mine(session, user, installed.plugin_id)

    return AttachedOut(
        agent=await _out(row),
        bot_token=installed.bot_token,
        signing_secret=installed.signing_secret,
    )


@router.delete("/mine/{agent_id}", response_model=OkOut)
async def detach(
    agent_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Remove your agent. Everything it said stays; its bot is retired the way any app's is."""
    async with transaction() as (session, _after):
        row = await _mine(session, user, agent_id)
        await registry.uninstall(session, agent_id, user.workspace_id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.detached",
            target_type="plugin",
            target_id=agent_id,
            metadata={"slug": row.slug, "name": row.name},
        )
    return OkOut()


@router.get("/mine/{agent_id}/channels", response_model=AgentChannelsOut)
async def agent_channels(
    agent_id: IdParam, user: SessionUser = Depends(current_user)
) -> AgentChannelsOut:
    """Where your agent could be, and where it is.

    Only channels *you* are in are offered — an agent you own may not be put somewhere
    you cannot read, which is the rule the admin route applies to the admin.
    """
    async with session_scope() as session:
        row = await _mine(session, user, agent_id)
        bot_id = await registry.bot_user_id(session, str(row.id))
        rows = (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.name, c.kind,
                           EXISTS (SELECT 1 FROM channel_members b
                                    WHERE b.channel_id = c.id
                                      AND b.user_id = cast(:bot AS uuid)) AS joined
                      FROM channels c
                      JOIN channel_members m ON m.channel_id = c.id AND m.user_id = :me
                     WHERE c.workspace_id = :ws
                       AND c.archived_at IS NULL
                       AND c.kind IN ('public', 'private')
                     ORDER BY c.name
                    """
                ),
                {"ws": user.workspace_id, "me": user.id, "bot": bot_id},
            )
        ).fetchall()
    return AgentChannelsOut(
        channels=[
            AgentChannel(id=str(r.id), name=r.name, kind=r.kind, joined=bool(r.joined))
            for r in rows
        ]
    )


@router.post("/mine/{agent_id}/channels/{channel_id}", response_model=OkOut)
async def agent_join_channel(
    agent_id: IdParam,
    channel_id: IdParam,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    async with transaction() as (session, _after):
        row = await _mine(session, user, agent_id)
        bot_id = await registry.bot_user_id(session, str(row.id))
        if not bot_id:
            raise bad_request("That agent has no bot to add.", code="no_bot")
        # Your access decides, not the bot's: adding your agent somewhere you cannot see
        # would be a way to read a channel you are not in.
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        await channel_service.join(session, channel_id, bot_id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.channel_joined",
            target_type="channel",
            target_id=channel_id,
            metadata={"pluginId": agent_id, "slug": row.slug},
        )
    return OkOut()


@router.delete("/mine/{agent_id}/channels/{channel_id}", response_model=OkOut)
async def agent_leave_channel(
    agent_id: IdParam,
    channel_id: IdParam,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    async with transaction() as (session, _after):
        row = await _mine(session, user, agent_id)
        bot_id = await registry.bot_user_id(session, str(row.id))
        if not bot_id:
            raise bad_request("That agent has no bot to remove.", code="no_bot")
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_member=True
        )
        await channel_service.leave(session, channel_id, bot_id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.channel_left",
            target_type="channel",
            target_id=channel_id,
            metadata={"pluginId": agent_id, "slug": row.slug},
        )
    return OkOut()


async def _mine(session: AsyncSession, user: SessionUser, agent_id: str) -> Any:
    """The agent, if it is this person's. 404 otherwise — whose it is stays private."""
    row = (
        await session.execute(
            text(
                """
                SELECT p.id, p.slug, p.name, p.description, p.status, p.created_at,
                       u.id AS bot_user_id
                  FROM plugins p
                  LEFT JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.id = :id AND p.workspace_id = :ws AND p.owner_user_id = :me
                """
            ),
            {"id": agent_id, "ws": user.workspace_id, "me": user.id},
        )
    ).fetchone()
    if row is None:
        raise not_found("You have no agent by that id.")
    return row


async def _free_slug(session: AsyncSession, workspace_id: str, base: str) -> str:
    """`base`, or the first `base-N` nobody holds. Slugs are per workspace and permanent."""
    taken = {
        str(r.slug)
        for r in (
            await session.execute(
                text("SELECT slug FROM plugins WHERE workspace_id = :ws AND slug LIKE :like"),
                {"ws": workspace_id, "like": f"{base}%"},
            )
        ).fetchall()
    }
    if base not in taken:
        return base
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if candidate not in taken:
            return candidate
    raise bad_request("Too many agents share that name already; pick another.")


async def _out(row: Any) -> MyAgentOut:
    return MyAgentOut(
        id=str(row.id),
        slug=row.slug,
        name=row.name,
        description=row.description,
        status=row.status,
        online=await gateway.is_online(str(row.id)),
        bot_user_id=str(row.bot_user_id) if row.bot_user_id else None,
        created_at=require_iso(row.created_at),
    )


__all__ = ["PERSONAL_SCOPES", "router"]
