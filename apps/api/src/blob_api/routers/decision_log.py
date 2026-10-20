"""Decisions (M2 · A8): record one, find one, change or revoke one.

Shapes and authorizes; `services/decisions.py` decides. A decision is read under its
channel's membership, so a private channel's decisions answer 404 to anybody outside it,
as the channel does. Recording or revoking one tells the channel its source message
changed — the message's `decisionId` — past COMMIT, as pinning does.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.ids import ID_PATTERN, IdParam
from ..schemas.base import CamelModel, iso, require_iso
from ..services import decision_log as decision_service

router = APIRouter(tags=["decisions"])


class DecisionOut(CamelModel):
    id: str
    channel_id: str
    channel_name: str | None
    channel_kind: str
    #: The message it was settled in, when it rests on one.
    message_id: str | None
    thread_root_id: str | None
    title: str
    rationale: str
    #: Who recorded it — the person who approved it, when an agent proposed it.
    decided_by: str | None
    #: The agent that proposed it, if one did, and what it is called.
    proposed_by: str | None
    proposed_by_name: str | None
    created_at: str
    updated_at: str
    revoked_at: str | None
    revoked_by: str | None


class DecisionsOut(CamelModel):
    decisions: list[DecisionOut]
    #: Pass as `before` for the next, older page; absent at the end.
    next_before: str | None = None


class DecisionIn(CamelModel):
    title: str = Field(min_length=1, max_length=1_000)
    rationale: str | None = Field(default=None, max_length=4_000)
    message_id: IdParam | None = None
    client_id: str = Field(min_length=1, max_length=decision_service.CLIENT_ID_MAX)


class DecisionPatch(CamelModel):
    title: str | None = Field(default=None, max_length=1_000)
    rationale: str | None = Field(default=None, max_length=4_000)


class RevokeIn(CamelModel):
    #: False puts a revoked decision back, standing.
    revoked: bool = True


def _out(found: decision_service.DecisionView) -> DecisionOut:
    return DecisionOut(
        id=found.id,
        channel_id=found.channel_id,
        channel_name=found.channel_name,
        channel_kind=found.channel_kind,
        message_id=found.message_id,
        thread_root_id=found.thread_root_id,
        title=found.title,
        rationale=found.rationale,
        decided_by=found.decided_by,
        proposed_by=found.proposed_by,
        proposed_by_name=found.proposed_by_name,
        created_at=require_iso(found.created_at),
        updated_at=require_iso(found.updated_at),
        revoked_at=iso(found.revoked_at),
        revoked_by=found.revoked_by,
    )


@router.get("/api/decisions", response_model=DecisionsOut)
async def list_decisions(
    user: SessionUser = Depends(current_user),
    channel_id: str | None = Query(default=None, alias="channelId", pattern=ID_PATTERN),
    q: str | None = Query(default=None, max_length=200),
    revoked: bool = False,
    before: str | None = Query(default=None, pattern=ID_PATTERN),
    limit: int = Query(default=50, ge=1, le=decision_service.LIST_MAX),
) -> DecisionsOut:
    """What was decided in the conversations this person is in, newest first."""
    async with session_scope() as session:
        found = await decision_service.list_for(
            session,
            user_id=user.id,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            query=q,
            include_revoked=revoked,
            before=before,
            limit=limit,
        )
    return DecisionsOut(
        decisions=[_out(item) for item in found],
        next_before=found[-1].id if len(found) == limit else None,
    )


@router.get("/api/decisions/{decision_id}", response_model=DecisionOut)
async def get_decision(
    decision_id: IdParam, user: SessionUser = Depends(current_user)
) -> DecisionOut:
    async with session_scope() as session:
        return _out(await decision_service.view_for(session, user.id, decision_id))


@router.post("/api/channels/{channel_id}/decisions", response_model=DecisionOut)
async def record_decision(
    channel_id: IdParam, payload: DecisionIn, user: SessionUser = Depends(current_user)
) -> DecisionOut:
    """Record what this conversation decided, in your name — from a message (`messageId`),
    or on its own. A repeat of the same `clientId` answers the decision already made."""
    async with transaction() as (session, after):
        found, made = await decision_service.record(
            session,
            workspace_id=user.workspace_id,
            user_id=user.id,
            channel_id=channel_id,
            title=payload.title,
            rationale=payload.rationale,
            message_id=payload.message_id,
            client_id=payload.client_id,
        )
        if made:
            await decision_service.announce_source(session, after, found)
    return _out(found)


@router.patch("/api/decisions/{decision_id}", response_model=DecisionOut)
async def change_decision(
    decision_id: IdParam, payload: DecisionPatch, user: SessionUser = Depends(current_user)
) -> DecisionOut:
    """Reword it, or say why. The person who recorded it, or an admin."""
    async with transaction() as (session, _after):
        found = await decision_service.change(
            session, user.id, decision_id, title=payload.title, rationale=payload.rationale
        )
    return _out(found)


@router.post("/api/decisions/{decision_id}/revoke", response_model=DecisionOut)
async def revoke_decision(
    decision_id: IdParam, payload: RevokeIn, user: SessionUser = Depends(current_user)
) -> DecisionOut:
    """It no longer stands — or it does again. Kept either way."""
    async with transaction() as (session, after):
        found = await decision_service.revoke(
            session, user.id, decision_id, revoked=payload.revoked
        )
        await decision_service.announce_source(session, after, found)
    return _out(found)


__all__ = ["router"]
