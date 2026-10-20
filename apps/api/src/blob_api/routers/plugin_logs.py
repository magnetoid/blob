"""What an agent did — its runs and what each streamed, what it remembers, and the
deliveries it was sent.

The console's read side for one installed app, split from `routers/plugins.py` in phase 8
of the agentic review; same prefix. What a run did is shown only where the admin can see
the room (`services/agent_runs`), and what an agent remembers of somebody is never shown
to an admin at all (ADR 0024).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import not_found
from ..lib.ids import IdParam
from ..plugins import delivery as delivery_log
from ..plugins import registry
from ..schemas.base import CamelModel, OkOut, iso, require_iso
from ..schemas.models import AgentMemory, AgentNote
from ..services import agent_notes as agent_notes_service
from ..services import agent_runs as agent_run_service
from ..services import agent_state as agent_state_service
from ..services import audit as audit_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/plugins")


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
    #: Hops from the person who rooted the chain; 0 when they mentioned it themselves.
    depth: int = 0
    #: The agent whose reply asked this one, when depth > 0. ADR 0013.
    asked_by: str | None = None
    #: Tokens the agent reported for the run, or None if it reported none.
    tokens: int | None = None
    #: What it did — the card it left — and what it was shown, for opening one run.
    card: dict[str, Any] | None = None
    seen: dict[str, Any] | None = None


class AgentRunsOut(CamelModel):
    runs: list[AgentRunOut]


class RunEventOut(CamelModel):
    #: Milliseconds from the start of the run.
    ms: int
    #: Which round of a run that used Blob's tools it arrived in, from 0.
    round: int
    #: The AG-UI event, cut down (`plugins/run_trail.py`).
    event: dict[str, Any]


class RunEventsOut(CamelModel):
    """What one run streamed: the newest 200 of `total` events."""

    #: The run was in a room the viewer cannot see, so its events are kept from them.
    hidden: bool
    total: int
    events: list[RunEventOut]
    #: When the nightly sweep empties them; the run itself stays for its thirty days.
    kept_until: str


class AgentMemoriesOut(CamelModel):
    memories: list[AgentMemory]


@router.get("/{plugin_id}/memory", response_model=AgentMemoriesOut)
async def agent_memory(
    plugin_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> AgentMemoriesOut:
    """What this agent remembers of conversations — the memories nobody owns — in the
    conversations you can see.

    A memory is made of what was said in the room, so a private room you are not in keeps
    its agent's memory out of your sight as it keeps its messages. A person's own memory
    with an agent they own or borrow is theirs, in their Settings, and never listed here.
    """
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        memories = await agent_state_service.for_conversations(
            session, workspace_id=admin.workspace_id, plugin_id=plugin_id, viewer_id=admin.id
        )
    return AgentMemoriesOut(memories=memories)


async def _forget_conversations(
    request: Request, admin: SessionUser, plugin_id: str, memory_id: str | None
) -> None:
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        forgotten = await agent_state_service.forget_conversations(
            session, workspace_id=admin.workspace_id, plugin_id=plugin_id, memory_id=memory_id
        )
        if memory_id is not None and not forgotten:
            raise not_found("That memory is already gone.")
        await audit_service.record(
            session,
            actor_for(request, admin),
            "agent.memory_forgotten",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"memoryId": memory_id, "count": forgotten},
        )


@router.delete("/{plugin_id}/memory/{memory_id}", response_model=OkOut)
async def forget_agent_memory(
    plugin_id: IdParam,
    memory_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    """Clear one conversation's memory of this agent — an agent that learned something
    wrong there starts it fresh."""
    await _forget_conversations(request, admin, plugin_id, memory_id)
    return OkOut()


@router.delete("/{plugin_id}/memory", response_model=OkOut)
async def forget_all_agent_memory(
    plugin_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Clear every conversation's memory of this agent, including rooms you are not in —
    clearing reveals nothing of them. People's own memories with it are untouched."""
    await _forget_conversations(request, admin, plugin_id, None)
    return OkOut()


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
            session, admin.workspace_id, plugin_id, admin.id, limit=limit
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
                depth=run.depth,
                asked_by=run.asked_by,
                tokens=run.tokens,
                card=run.card,
                seen=run.seen,
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


@router.get("/{plugin_id}/runs/{run_id}/events", response_model=RunEventsOut)
async def run_events(
    plugin_id: IdParam, run_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> RunEventsOut:
    """What the agent streamed in one run — for when the card and the error do not say
    why it went the way it did. Only where you can see the room it ran in."""
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        found = await agent_run_service.events_of(
            session,
            workspace_id=admin.workspace_id,
            plugin_id=plugin_id,
            run_id=run_id,
            viewer_id=admin.id,
        )
    if found is None:
        raise not_found("There is no run with that id.")
    events: list[RunEventOut] = []
    for entry in found["events"]:
        if (
            isinstance(entry, dict)
            and isinstance(entry.get("ms"), int)
            and isinstance(entry.get("round"), int)
            and isinstance(entry.get("event"), dict)
        ):
            events.append(RunEventOut(ms=entry["ms"], round=entry["round"], event=entry["event"]))
    return RunEventsOut(
        hidden=found["hidden"], total=found["total"], events=events, kept_until=found["keptUntil"]
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
        rows = await delivery_log.deliveries(session, plugin_id, limit=limit)
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
        row = await delivery_log.delivery(session, plugin_id, delivery_id)
    return DeliveryDetailOut(**_to_delivery(row).model_dump(), payload=row.payload)


@router.post("/{plugin_id}/deliveries/{delivery_id}/replay", response_model=DeliveryOut)
async def replay_delivery(
    plugin_id: IdParam,
    delivery_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> DeliveryOut:
    """Queue a failed or dead delivery to be sent again.

    Pending rows are already in the drain; delivered ones already arrived. Replaying
    those would either no-op or double-send. Failed and dead are the ones an operator
    can usefully push — after a fix on the app side, or after the circuit is closed.
    """
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        row = await delivery_log.replay_delivery(session, plugin_id, delivery_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "plugin.delivery_replayed",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"deliveryId": delivery_id},
        )
    return _to_delivery(row)


# ─── the notes an agent kept of conversations (M2 · A8) ──────────────────────────────


class AgentNotesOut(CamelModel):
    notes: list[AgentNote]


class AgentNoteIn(CamelModel):
    body: str = Field(min_length=1, max_length=2_000)


def _note_out(note: agent_notes_service.ListedNote) -> AgentNote:
    return AgentNote(
        id=note.id,
        plugin_id=note.plugin_id,
        agent_name=note.agent_name,
        channel_id=note.channel_id,
        channel_name=note.channel_name,
        channel_kind=note.channel_kind,
        body=note.body,
        updated_at=require_iso(note.updated_at),
    )


@router.get("/{plugin_id}/notes", response_model=AgentNotesOut)
async def agent_notes(
    plugin_id: IdParam, admin: SessionUser = Depends(require_admin)
) -> AgentNotesOut:
    """What this agent noted of conversations — the notes nobody owns — in the conversations
    you can see. A person's own notes with an agent they own or borrow are theirs."""
    async with session_scope() as session:
        await registry.by_id(session, plugin_id, admin.workspace_id)
        notes = await agent_notes_service.for_conversations(
            session, workspace_id=admin.workspace_id, plugin_id=plugin_id, viewer_id=admin.id
        )
    return AgentNotesOut(notes=[_note_out(note) for note in notes])


async def _change_note(
    request: Request, admin: SessionUser, plugin_id: str, note_id: str, body: str | None
) -> AgentNote:
    async with transaction() as (session, _after):
        await registry.by_id(session, plugin_id, admin.workspace_id)
        note = await agent_notes_service.change_conversation(
            session,
            workspace_id=admin.workspace_id,
            plugin_id=plugin_id,
            viewer_id=admin.id,
            note_id=note_id,
            body=body,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "agent.note_forgotten" if body is None else "agent.note_changed",
            target_type="plugin",
            target_id=plugin_id,
            metadata={"noteId": note_id},
        )
    return _note_out(note)


@router.patch("/{plugin_id}/notes/{note_id}", response_model=AgentNote)
async def reword_agent_note(
    plugin_id: IdParam,
    note_id: IdParam,
    payload: AgentNoteIn,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> AgentNote:
    """Correct what the agent noted — what an admin does to an agent that learned it wrong."""
    return await _change_note(request, admin, plugin_id, note_id, payload.body)


@router.delete("/{plugin_id}/notes/{note_id}", response_model=OkOut)
async def forget_agent_note(
    plugin_id: IdParam,
    note_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_admin),
) -> OkOut:
    await _change_note(request, admin, plugin_id, note_id, None)
    return OkOut()
