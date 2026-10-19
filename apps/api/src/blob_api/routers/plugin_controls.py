"""What an agent is told and may do — the controls on an installed agent's page.

Its daily budget, the workspace's instructions, whether it joins every public channel,
what it may do with Blob's tools, and whether its card shows its reasoning. Split from
`routers/plugins.py` (what an app *is*) in phase 8 of the agentic review; same prefix,
and every route answers with the app as `PluginOut`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from ..db.engine import transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import bad_request
from ..lib.ids import IdParam
from ..plugins import agent_settings, registry
from ..schemas.base import CamelModel, require_iso
from ..services import agent_follows, janus_agent
from ..services import audit as audit_service
from ..services.audit import actor_for
from .plugins import PluginOut, _to_plugin

router = APIRouter(tags=["admin"], prefix="/api/admin/plugins")


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
        await agent_settings.set_budget(
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


def _assert_the_workspace_may_direct(row: Any, *, owned: str, not_seeded: str) -> None:
    """Both controls below are the workspace's word about **the agent Blob seeded**.

    Two refusals rather than one, because they call for different answers. An agent with
    an owner answers that person and whoever they lent it to (ADR 0018), so the
    workspace's word would be spoken through somebody's private assistant — that is
    `agent_is_owned`, and it is checked first because it is the case an admin can undo.

    Anything else holding neither identity is an app somebody registered: it never
    declared a field for a workspace prompt, and seating it in every public channel
    founded from now on widens how far its `messages:write` reaches without an admin ever
    seeing themselves widen it. The property the migration claims is held here, not on the
    page that hides the field — the page is a courtesy; this is the lock.
    """
    if getattr(row, "owner_user_id", None) is not None:
        raise bad_request(owned, code="agent_is_owned")
    if not janus_agent.is_seeded_row(row):
        raise bad_request(not_seeded, code="agent_not_seeded")


class InstructionsInput(CamelModel):
    """What the workspace tells its agent. Empty, blank or an explicit null clears it.

    `text` is required, with no default: `extra="ignore"` is the wire's rule, so a body
    with the key misspelt or missing would otherwise arrive as "clear it" and wipe the
    workspace's prompt with nothing on screen to say why.

    4000 characters is Janus's ceiling for `forwardedProps.instructions`; a longer text
    would be refused at the far end after the admin had been told it was saved.
    """

    text: str | None = Field(max_length=4000)

    @field_validator("text", mode="before")
    @classmethod
    def _trim_before_measuring(cls, value: Any) -> Any:
        """Trimmed before the length check, not after it.

        A textarea hands back what was typed plus the newline the person ended on, and
        measuring first refused a 4000-character instruction over a character that is
        never stored.
        """
        return value.strip() if isinstance(value, str) else value


@router.post("/{plugin_id}/instructions", response_model=PluginOut)
async def set_instructions(
    plugin_id: IdParam,
    payload: InstructionsInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    """Set (or clear) the standing instruction this workspace sends with every run.

    It travels as `forwardedProps.instructions` on the run input, which the agent reads
    as an ephemeral system prompt for that run — Blob keeps no copy in the conversation
    and the agent keeps none between runs. Per workspace rather than in the agent's own
    configuration because one Janus container serves every workspace on the instance.
    """
    async with transaction() as (session, _after):
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)
        _assert_the_workspace_may_direct(
            existing,
            owned="A person's own agent is not the workspace's to instruct.",
            not_seeded="Only the agent Blob seeds takes workspace instructions.",
        )
        stored = await agent_settings.set_instructions(
            session, plugin_id, admin.workspace_id, payload.text
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.instructions_set",
            target_type="plugin",
            target_id=plugin_id,
            # The length, never the text: the log is read by people who are not entitled
            # to the workspace's prompt, and "somebody changed it, by this much" is the
            # forensic fact.
            metadata={"pluginId": plugin_id, "length": len(stored or "")},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


class EverywhereInput(CamelModel):
    #: Required, for the reason `InstructionsInput.text` is: an absent key must not read
    #: as "off" and quietly stand the agent down from every room founded afterwards.
    enabled: bool


@router.post("/{plugin_id}/everywhere", response_model=PluginOut)
async def set_everywhere(
    plugin_id: IdParam,
    payload: EverywhereInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    """Whether this agent joins public channels founded from now on.

    Where the bot goes next, and nothing else. No channel that already exists gains the
    bot or loses it — today's rooms are the channels list's business, one join at a time
    and visible as itself — and the boot-time backfill in `services/janus_agent.ensure`
    reads the same switch, so turning it off still means it after the next deploy.

    What it deliberately does *not* decide is whether this is the workspace's resident
    agent: that is the agent's identity (`services/janus_agent.SEEDED_AGENT`), read by
    `services/users.list_users` for the home view. It used to be this flag, so choosing
    invitation-only also stopped the home view addressing the agent at all.
    """
    async with transaction() as (session, _after):
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)
        _assert_the_workspace_may_direct(
            existing,
            owned="A person's own agent is not the workspace's to place.",
            not_seeded="Only the agent Blob seeds is placed in every public channel.",
        )
        await agent_settings.set_in_every_public_channel(
            session, plugin_id, admin.workspace_id, payload.enabled
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.everywhere_set",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"pluginId": plugin_id, "enabled": payload.enabled},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


class ToolsInput(CamelModel):
    #: Required: an absent key must not read as "none" and quietly take an agent's tools.
    access: Literal["none", "read", "write"]
    #: Optional, and absent means unchanged: which of its posts wait for the person.
    approval: Literal["ask", "auto_in_dm", "auto_everywhere"] | None = None


@router.post("/{plugin_id}/tools", response_model=PluginOut)
async def set_tool_access(
    plugin_id: IdParam,
    payload: ToolsInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    """What this agent may do in the workspace with Blob's tools (ADR 0022).

    `read`: it may list, read and search channels and list people — as the person who
    asked it something, and only inside the room it was asked in (public channels and
    that room; the person's whole reach only in its own DM with them). `write`: also post,
    as itself. `none` is the default.

    `approval` says which posts wait for that person (migration 0054): `ask`, every one —
    the default; `auto_in_dm`, none asked for in the agent's own DM with them; or
    `auto_everywhere`, none. It never widens where a post may go.
    """
    async with transaction() as (session, _after):
        existing = await registry.by_id(session, plugin_id, admin.workspace_id)
        if payload.access != "none" and not (existing.agui_url or existing.runtime == "socket"):
            raise bad_request(
                "Only an agent that answers over AG-UI can be offered Blob's tools.",
                code="not_an_agent",
            )
        await agent_settings.set_tool_access(session, plugin_id, admin.workspace_id, payload.access)
        if payload.approval is not None:
            await agent_settings.set_write_approval(
                session, plugin_id, admin.workspace_id, payload.approval
            )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.tools_set",
            target_type="plugin",
            target_id=plugin_id,
            metadata={
                "pluginId": plugin_id,
                "access": payload.access,
                **({"approval": payload.approval} if payload.approval is not None else {}),
            },
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


class ReasoningInput(CamelModel):
    shown: bool


@router.post("/{plugin_id}/reasoning", response_model=PluginOut)
async def set_reasoning_shown(
    plugin_id: IdParam,
    payload: ReasoningInput,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> PluginOut:
    """Whether this agent's run cards show its reasoning to the channel.

    Off by default: the card is the whole channel's, and an agent's working-out is where
    it narrates what it read — from tools and memory of its own that reach past the room.
    Turned on for an agent whose reasoning is worth reading and safe to share.
    """
    async with transaction() as (session, _after):
        await agent_settings.set_shows_reasoning(
            session, plugin_id, admin.workspace_id, payload.shown
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.reasoning_set",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"pluginId": plugin_id, "shown": payload.shown},
        )
        row = await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _to_plugin(session, row)


# ─── channels it follows (ADR 0026) ──────────────────────────────────────────


class FollowedChannelOut(CamelModel):
    id: str
    name: str | None
    kind: str
    #: When an admin set it following there.
    since: str


class FollowsOut(CamelModel):
    channels: list[FollowedChannelOut]


async def _follows(session: Any, workspace_id: str, plugin_id: str) -> FollowsOut:
    rows = await agent_follows.channels_of(session, workspace_id=workspace_id, plugin_id=plugin_id)
    return FollowsOut(
        channels=[
            FollowedChannelOut(
                id=str(row.id), name=row.name, kind=row.kind, since=require_iso(row.created_at)
            )
            for row in rows
        ]
    )


@router.get("/{plugin_id}/follows", response_model=FollowsOut)
async def list_follows(
    plugin_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> FollowsOut:
    """The channels this agent follows: it hears people's messages there without a mention."""
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        return await _follows(session, admin.workspace_id, plugin_id)


@router.put("/{plugin_id}/follows/{channel_id}", response_model=FollowsOut)
async def follow_channel(
    plugin_id: IdParam,
    channel_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> FollowsOut:
    """Let this agent hear every message a person posts in this channel (ADR 0026).

    Not addressed to it, so it can stay quiet: each such run is read-only, shows no card
    in the room, and is throttled — a cooldown per channel and a daily cap. The agent's
    bot must already be in the channel; following is not joining.
    """
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        await agent_follows.follow(
            session,
            workspace_id=admin.workspace_id,
            plugin_id=plugin_id,
            channel_id=channel_id,
            by=admin.id,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.follow_set",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"pluginId": plugin_id, "channelId": channel_id, "following": True},
        )
        return await _follows(session, admin.workspace_id, plugin_id)


@router.delete("/{plugin_id}/follows/{channel_id}", response_model=FollowsOut)
async def unfollow_channel(
    plugin_id: IdParam,
    channel_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> FollowsOut:
    """Stop this agent hearing the channel. It stays a member; a mention still reaches it."""
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        if await agent_follows.unfollow(
            session, workspace_id=admin.workspace_id, plugin_id=plugin_id, channel_id=channel_id
        ):
            await audit_service.record(
                session,
                actor_for(request, admin),
                "plugin.follow_set",
                target_type="plugin",
                target_id=plugin_id,
                metadata={"pluginId": plugin_id, "channelId": channel_id, "following": False},
            )
        return await _follows(session, admin.workspace_id, plugin_id)
