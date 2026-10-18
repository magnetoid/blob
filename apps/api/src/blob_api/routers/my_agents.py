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

import asyncio
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, not_found
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..plugins import gateway, registry
from ..plugins.manifest import Manifest
from ..schemas.base import CamelModel, OkOut, require_iso
from ..schemas.models import AgentMemory
from ..services import agent_access
from ..services import agent_state as agent_state_service
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import commands as command_service
from ..services import my_agents as agent_service
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


#: Resolved once at import, not per request: resolving touches the filesystem too.
_BRIDGE_SOURCE = Path(__file__).resolve().parent.parent / "tools" / "agent_bridge.py"


@router.get("/bridge", response_class=PlainTextResponse)
async def bridge_source(_user: SessionUser = Depends(current_user)) -> str:
    """The bridge script, for anybody with an agent to connect.

    The admin console serves the same file at `/api/admin/plugins/bridge`; a member's
    setup screen cannot link there. The script itself holds nothing secret — the token
    and the secret travel in the environment the person sets up beside it.
    """
    # Off the event loop: a file read blocks every other request this process serves.
    return await asyncio.to_thread(_BRIDGE_SOURCE.read_text, encoding="utf-8")


class WorkspaceAgentOut(CamelModel):
    id: str
    name: str
    bot_user_id: str
    #: Whether this one is the caller's own. The workspace's (unowned) ones are everybody's.
    mine: bool
    online: bool | None = None


class WorkspaceAgentsOut(CamelModel):
    agents: list[WorkspaceAgentOut]


@router.get("", response_model=WorkspaceAgentsOut)
async def list_available(user: SessionUser = Depends(current_user)) -> WorkspaceAgentsOut:
    """The agents this person may bring into a piece of work: the workspace's, theirs,
    and any lent to them everywhere.

    Somebody else's owned agent is not listed otherwise. Not out of secrecy — its bot is
    a member people can see — but because offering it would produce a refusal, and a list
    that refuses half its entries is worse than a shorter list.
    """
    async with session_scope() as session:
        rows = await agent_service.available(session, user)
    agents = []
    for row in rows:
        agents.append(
            WorkspaceAgentOut(
                id=str(row.id),
                name=row.name,
                bot_user_id=str(row.bot_user_id),
                # Yours: owned by the person asking. An agent somebody lent them is in the
                # list too, and is not theirs — the picker labels this one "yours".
                mine=row.owner_user_id is not None and str(row.owner_user_id) == user.id,
                online=await gateway.is_online(str(row.id)) if row.runtime == "socket" else None,
            )
        )
    return WorkspaceAgentsOut(agents=agents)


@router.get("/mine", response_model=MyAgentsOut)
async def list_mine(user: SessionUser = Depends(current_user)) -> MyAgentsOut:
    async with session_scope() as session:
        rows = await agent_service.mine(session, user)
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

        slug = await agent_service.free_slug(session, user.workspace_id, base)
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
        await registry.set_owner(session, installed.plugin_id, user.workspace_id, user.id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.attached",
            target_type="plugin",
            target_id=installed.plugin_id,
            metadata={"slug": slug, "name": name},
        )
        row = await agent_service.owned(session, user, installed.plugin_id)

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
        row = await agent_service.owned(session, user, agent_id)
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
        row = await agent_service.owned(session, user, agent_id)
        bot_id = await registry.bot_user_id(session, str(row.id))
        rows = await agent_service.channels_for(session, user, bot_id)
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
        row = await agent_service.owned(session, user, agent_id)
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
        row = await agent_service.owned(session, user, agent_id)
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


# ─── who your agent is lent to ───────────────────────────────────────────────


class LoanOut(CamelModel):
    id: str
    grantee_user_id: str
    grantee_name: str
    #: None for a loan that covers everywhere the agent is.
    channel_id: str | None = None
    channel_name: str | None = None
    granted_at: str


class LoansOut(CamelModel):
    loans: list[LoanOut]


@router.get("/mine/{agent_id}/loans", response_model=LoansOut)
async def agent_loans(agent_id: IdParam, user: SessionUser = Depends(current_user)) -> LoansOut:
    """Everyone your agent is lent to, and where — the loans `/allow` made, listed, so
    one made months ago is not something you have to remember to know about."""
    async with session_scope() as session:
        row = await agent_service.owned(session, user, agent_id)
        loans = await agent_access.delegations_of(session, plugin_id=str(row.id))
    return LoansOut(
        loans=[
            LoanOut(
                id=loan.id,
                grantee_user_id=loan.grantee_user_id,
                grantee_name=loan.grantee_name,
                channel_id=loan.channel_id,
                channel_name=loan.channel_name,
                granted_at=require_iso(loan.granted_at),
            )
            for loan in loans
        ]
    )


@router.delete("/mine/{agent_id}/loans/{loan_id}", response_model=OkOut)
async def agent_end_loan(
    agent_id: IdParam,
    loan_id: IdParam,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    """End one loan. `/disallow` still does the same from a channel."""
    async with transaction() as (session, _after):
        row = await agent_service.owned(session, user, agent_id)
        ended = await agent_access.revoke_by_id(
            session, plugin_id=str(row.id), delegation_id=loan_id
        )
        if not ended:
            raise not_found("That loan has already ended.")
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.loan_ended",
            target_type="plugin",
            target_id=agent_id,
            metadata={"loanId": loan_id},
        )
    return OkOut()


# ─── what agents remember of you ─────────────────────────────────────────────


class MemoriesOut(CamelModel):
    memories: list[AgentMemory]


@router.get("/memory", response_model=MemoriesOut)
async def my_memories(user: SessionUser = Depends(current_user)) -> MemoriesOut:
    """What agents remember of your own conversations with them: an agent you own, or
    one lent to you, keeps a memory per person (migration 0050). Yours to read and to
    clear. The workspace's agents remember conversations, not people — those are an
    admin's to clear, on the agent's page."""
    async with session_scope() as session:
        memories = await agent_state_service.for_person(
            session, workspace_id=user.workspace_id, person_id=user.id
        )
    return MemoriesOut(memories=memories)


async def _forget_mine(request: Request, user: SessionUser, memory_id: str | None) -> int:
    async with transaction() as (session, _after):
        forgotten = await agent_state_service.forget_own(
            session, workspace_id=user.workspace_id, person_id=user.id, memory_id=memory_id
        )
        if memory_id is not None and not forgotten:
            raise not_found("That memory is already gone.")
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.memory_forgotten",
            target_type="user",
            target_id=user.id,
            metadata={"memoryId": memory_id, "count": forgotten},
        )
    return forgotten


@router.delete("/memory/{memory_id}", response_model=OkOut)
async def forget_my_memory(
    memory_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    await _forget_mine(request, user, memory_id)
    return OkOut()


@router.delete("/memory", response_model=OkOut)
async def forget_all_my_memories(
    request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    await _forget_mine(request, user, None)
    return OkOut()


__all__ = ["PERSONAL_SCOPES", "router"]
