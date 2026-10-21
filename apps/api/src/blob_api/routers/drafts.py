"""Drafts that follow you (ADR 0037): read and written by their author alone.

Saved as somebody types, a pause at a time; an empty body forgets the draft. Each save is
told to the author's other sockets as `draft.updated`, so a laptop's sentence is in the
phone's composer the next time that conversation opens — and to nobody else's.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import not_found
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..realtime import hub
from ..schemas.base import CamelModel, require_iso
from ..schemas.requests import MESSAGE_MAX_LENGTH
from ..services import channels as channel_service
from ..services import drafts as draft_service
from ..services import messages as message_service

router = APIRouter()


class DraftOut(CamelModel):
    channel_id: str
    thread_root_id: str | None = None
    body: str
    updated_at: str


class DraftsOut(CamelModel):
    drafts: list[DraftOut]


class DraftIn(CamelModel):
    channel_id: IdParam
    thread_root_id: IdParam | None = None
    body: str = Field(max_length=MESSAGE_MAX_LENGTH)
    #: The tab that saved it, echoed in `draft.updated` so that tab can ignore its own
    #: save coming back — it may have been typed past since.
    device: str | None = Field(default=None, max_length=64)


class SavedDraftOut(CamelModel):
    #: None once an empty body has forgotten it.
    draft: DraftOut | None


def _out(row: Any) -> DraftOut:
    return DraftOut(
        channel_id=str(row.channel_id),
        thread_root_id=str(row.thread_root_id) if row.thread_root_id else None,
        body=row.body,
        updated_at=require_iso(row.updated_at),
    )


@router.get("/api/drafts", response_model=DraftsOut)
async def my_drafts(user: SessionUser = Depends(current_user)) -> DraftsOut:
    async with session_scope() as session:
        rows = await draft_service.list_for(session, user.id)
    return DraftsOut(drafts=[_out(row) for row in rows])


@router.put("/api/drafts", response_model=SavedDraftOut)
async def save_draft(payload: DraftIn, user: SessionUser = Depends(current_user)) -> SavedDraftOut:
    await consume("draft", user.id)
    async with transaction() as (session, after):
        # Only where you could send it: a member, in a room that takes messages.
        await channel_service.assert_channel_access(
            session, user.id, payload.channel_id, require_member=True, require_writable=True
        )
        if payload.thread_root_id:
            root = await message_service.load_for(
                session, user.id, payload.thread_root_id, allow_deleted=True
            )
            if root.channel_id != payload.channel_id:
                raise not_found("There is no such thread in that conversation.")
        row = await draft_service.save(
            session,
            user.id,
            channel_id=payload.channel_id,
            thread_root_id=payload.thread_root_id,
            body=payload.body,
        )
        saved = _out(row) if row is not None else None
        told = draft_service.event(
            payload.channel_id,
            payload.thread_root_id,
            saved.body if saved else "",
            saved.updated_at if saved else require_iso(datetime.now(UTC)),
            device=payload.device,
        )
        after.add(lambda: hub.to_users([user.id], told))
    return SavedDraftOut(draft=saved)
