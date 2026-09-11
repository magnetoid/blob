from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import AfterCommit, transaction
from ..db.models import User
from ..lib.auth import current_user
from ..lib.errors import forbidden
from ..realtime import hub
from ..schemas.meetups import MeetupCreate, MeetupOut, MeetupTokenOut
from ..services import meetups

router = APIRouter(prefix="/meetups", tags=["meetups"])


@router.post("", response_model=MeetupOut)
async def create_meetup(
    input_: MeetupCreate,
    user: User = Depends(current_user),
    db: tuple[AsyncSession, AfterCommit] = Depends(transaction),
) -> MeetupOut:
    session, after = db
    meetup = await meetups.create(session, user.workspace_id, user.id, input_)
    if meetup.channel_id:
        channel_id = meetup.channel_id
        after.add(
            lambda: hub.to_channel(
                channel_id, {"t": "meetup.started", "meetup": meetup.model_dump(by_alias=True)}
            )
        )
    return meetup


@router.get("/{meetup_id}", response_model=MeetupOut)
async def get_meetup(
    meetup_id: str,
    user: User = Depends(current_user),
    db: tuple[AsyncSession, AfterCommit] = Depends(transaction),
) -> MeetupOut:
    session, _ = db
    return await meetups.get(session, user.workspace_id, meetup_id)


@router.post("/{meetup_id}/token", response_model=MeetupTokenOut)
async def get_meetup_token(
    meetup_id: str,
    user: User = Depends(current_user),
    db: tuple[AsyncSession, AfterCommit] = Depends(transaction),
) -> MeetupTokenOut:
    session, _ = db
    meetup = await meetups.get(session, user.workspace_id, meetup_id)
    return await meetups.generate_token(user.workspace_id, user.id, user.display_name, meetup)


@router.post("/{meetup_id}/end", response_model=MeetupOut)
async def end_meetup(
    meetup_id: str,
    user: User = Depends(current_user),
    db: tuple[AsyncSession, AfterCommit] = Depends(transaction),
) -> MeetupOut:
    session, after = db
    meetup = await meetups.get(session, user.workspace_id, meetup_id)
    if meetup.created_by != user.id and user.role != "admin":
        raise forbidden("only_creator_can_end_meetup")
    meetup = await meetups.end(session, user.workspace_id, meetup_id)
    if meetup.channel_id:
        channel_id = meetup.channel_id
        meetup_id_val = meetup.id
        after.add(
            lambda: hub.to_channel(channel_id, {"t": "meetup.ended", "meetupId": meetup_id_val})
        )
    return meetup
