"""Retention and legal hold (ADR 0039): the windows, what a window would take, and holds.

Every change here asks for a recent sign-in: a window removes history for good once it is
in force, and releasing a hold lets the next sweep reach what the hold kept.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope, transaction
from ..jobs import retention as retention_job
from ..lib.auth import SessionUser, require_admin, require_recent_admin
from ..lib.ids import IdParam
from ..realtime import hub
from ..schemas.base import CamelModel, OkOut, require_iso
from ..services import channels as channel_service
from ..services import message_versions as version_service
from ..services import messages as message_service
from ..services import retention as retention_service
from ..services.audit import actor_for
from ..services.serialize import channel_event
from ..services.workspace_settings import MAX_RETENTION_DAYS, MIN_RETENTION_DAYS

router = APIRouter(prefix="/api/admin")

Days = Annotated[int, Field(ge=MIN_RETENTION_DAYS, le=MAX_RETENTION_DAYS)]


class HeldConversationOut(CamelModel):
    id: str
    kind: str
    #: Null for a direct message.
    name: str | None = None
    held_at: str
    held_by: str | None = None


class HeldPersonOut(CamelModel):
    id: str
    display_name: str
    held_at: str
    held_by: str | None = None


class SweepOut(CamelModel):
    at: str
    messages: int = 0
    files: int = 0


class RetentionOut(CamelModel):
    #: Days a message, and a file, is kept; null keeps it for good.
    message_days: int | None = None
    file_days: int | None = None
    changed_at: str | None = None
    #: While the last change is still waiting its day: when it starts to count.
    takes_effect_at: str | None = None
    #: When the first sweep that applies the windows as they stand runs; null with none set.
    next_sweep_at: str | None = None
    last_sweep: SweepOut | None = None
    held_conversations: list[HeldConversationOut] = Field(default_factory=list)
    held_people: list[HeldPersonOut] = Field(default_factory=list)


class RetentionInput(CamelModel):
    message_days: Days | None = None
    file_days: Days | None = None


class RetentionPreviewOut(CamelModel):
    messages: int
    files: int
    #: The counts stopped at their ceiling: "more than".
    capped: bool


class LegalHoldInput(CamelModel):
    held: bool


def next_sweep(after: datetime) -> datetime:
    """The first nightly sweep at or after `after` — an hour past the backup's hour, at :40,
    as the worker schedules it."""
    hour = (settings.BACKUP_HOUR_UTC + 1) % 24
    at = after.astimezone(UTC).replace(hour=hour, minute=40, second=0, microsecond=0)
    return at if at >= after else at + timedelta(days=1)


async def _view(workspace_id: str) -> RetentionOut:
    now = datetime.now(UTC)
    async with session_scope() as session:
        policy = await retention_service.policy(session, workspace_id)
        conversations = await retention_service.held_conversations(session, workspace_id)
        people = await retention_service.held_people(session, workspace_id)
    waiting = policy.takes_effect_at(now)
    last: Any = await retention_job.last_sweep(workspace_id)
    return RetentionOut(
        message_days=policy.message_days,
        file_days=policy.file_days,
        changed_at=policy.changed_at.isoformat() if policy.changed_at else None,
        takes_effect_at=waiting.isoformat() if waiting else None,
        next_sweep_at=next_sweep(waiting or now).isoformat() if policy.enabled else None,
        last_sweep=(
            SweepOut(
                at=str(last.get("at")),
                messages=int(last.get("messages") or 0),
                files=int(last.get("files") or 0),
            )
            if last and last.get("at")
            else None
        ),
        held_conversations=[
            HeldConversationOut(
                id=str(row.id),
                kind=row.kind,
                name=row.name,
                held_at=require_iso(row.legal_hold_at),
                held_by=row.held_by,
            )
            for row in conversations
        ],
        held_people=[
            HeldPersonOut(
                id=str(row.id),
                display_name=row.display_name,
                held_at=require_iso(row.legal_hold_at),
                held_by=row.held_by,
            )
            for row in people
        ],
    )


@router.get("/retention", response_model=RetentionOut)
async def get_retention(admin: SessionUser = Depends(require_admin)) -> RetentionOut:
    return await _view(admin.workspace_id)


@router.put("/retention", response_model=RetentionOut)
async def set_retention(
    payload: RetentionInput, request: Request, admin: SessionUser = Depends(require_recent_admin)
) -> RetentionOut:
    async with transaction() as (session, _):
        await retention_service.set_policy(
            session,
            actor_for(request, admin),
            message_days=payload.message_days,
            file_days=payload.file_days,
        )
    # What was below the watermarks under the old windows may be due under the new ones.
    await retention_job.forget_watermarks(admin.workspace_id)
    return await _view(admin.workspace_id)


@router.get("/retention/preview", response_model=RetentionPreviewOut)
async def preview_retention(
    message_days: Annotated[
        int | None, Query(alias="messageDays", ge=MIN_RETENTION_DAYS, le=MAX_RETENTION_DAYS)
    ] = None,
    file_days: Annotated[
        int | None, Query(alias="fileDays", ge=MIN_RETENTION_DAYS, le=MAX_RETENTION_DAYS)
    ] = None,
    admin: SessionUser = Depends(require_admin),
) -> RetentionPreviewOut:
    """About what the first sweep under these windows would remove."""
    async with session_scope() as session:
        counted = await retention_service.preview(
            session,
            admin.workspace_id,
            message_days=message_days,
            file_days=file_days,
            now=datetime.now(UTC),
        )
    return RetentionPreviewOut(
        messages=counted.messages, files=counted.files, capped=counted.capped
    )


@router.put("/channels/{channel_id}/legal-hold", response_model=OkOut)
async def hold_conversation(
    channel_id: IdParam,
    payload: LegalHoldInput,
    request: Request,
    admin: SessionUser = Depends(require_recent_admin),
) -> OkOut:
    async with transaction() as (session, after):
        changed = await retention_service.hold_conversation(
            session, actor_for(request, admin), channel_id, held=payload.held
        )
        channel = (
            await channel_service.get_for_user(session, channel_id, admin.id) if changed else None
        )
        # Its members see the hold in the conversation's details, so they hear of it.
        if channel is not None:
            frame = channel_event("channel.updated", channel)
            after.add(lambda: hub.to_channel(channel_id, frame))
    if changed and not payload.held:
        await retention_job.forget_watermarks(admin.workspace_id)
    return OkOut()


@router.put("/users/{user_id}/legal-hold", response_model=OkOut)
async def hold_person(
    user_id: IdParam,
    payload: LegalHoldInput,
    request: Request,
    admin: SessionUser = Depends(require_recent_admin),
) -> OkOut:
    async with transaction() as (session, _):
        changed = await retention_service.hold_person(
            session, actor_for(request, admin), user_id, held=payload.held
        )
    if changed and not payload.held:
        await retention_job.forget_watermarks(admin.workspace_id)
    return OkOut()


class KeptVersionOut(CamelModel):
    body: str
    #: When these words were written: the message's creation, or the edit before.
    written_at: str
    #: When an edit replaced them.
    replaced_at: str


class KeptVersionsOut(CamelModel):
    #: Oldest first. Kept only while the conversation or its writer is on legal hold.
    versions: list[KeptVersionOut]
    #: Whether an edit now would keep the words it replaces.
    held: bool


@router.get("/messages/{message_id}/versions", response_model=KeptVersionsOut)
async def message_versions(
    message_id: IdParam, user: SessionUser = Depends(require_admin)
) -> KeptVersionsOut:
    """A message's earlier words that a legal hold kept (ADR 0039 addendum), for an admin
    who may read the conversation it is in — a private one only its members, as ever."""
    async with session_scope() as session:
        # Deleted too: a delete takes a message's words, not what a hold kept of them.
        await message_service.load_for(session, user.id, message_id, allow_deleted=True)
        rows = await version_service.of_message(session, message_id)
        held = await version_service.held(session, message_id)
    return KeptVersionsOut(
        versions=[
            KeptVersionOut(
                body=row.body,
                written_at=require_iso(row.written_at),
                replaced_at=require_iso(row.replaced_at),
            )
            for row in rows
        ],
        held=held,
    )
