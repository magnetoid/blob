"""Meetups: a LiveKit room attached to a channel.

Thin, like the other routers: authorise, call the service, broadcast after commit. The
one rule with teeth is that a meetup inherits its channel's access. Creating one in a
channel, minting a token for it and ending it all pass through `assert_channel_access`,
so a private channel's call is exactly as private as the channel — and answers 404 to
somebody outside it, because the channel does.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import forbidden
from ..lib.ids import IdParam
from ..realtime import hub
from ..schemas.meetups import MeetupCreate, MeetupOut, MeetupTokenOut
from ..services import channels as channel_service
from ..services import meetups

router = APIRouter(prefix="/api/meetups", tags=["meetups"])


async def _visible(session: AsyncSession, user: SessionUser, meetup_id: str) -> MeetupOut:
    """The meetup, if this person may see it: same workspace, and a member of its
    channel when it has one. A meetup with no channel is the workspace's."""
    meetup = await meetups.get(session, user.workspace_id, meetup_id)
    if meetup.channel_id:
        await channel_service.assert_channel_access(
            session, user.id, meetup.channel_id, require_member=True
        )
    return meetup


@router.post("", response_model=MeetupOut)
async def create_meetup(
    input_: MeetupCreate, user: SessionUser = Depends(current_user)
) -> MeetupOut:
    async with transaction() as (session, after):
        if input_.channel_id:
            await channel_service.assert_channel_access(
                session, user.id, input_.channel_id, require_member=True
            )
        meetup = await meetups.create(session, user.workspace_id, user.id, input_)
        if meetup.channel_id:
            channel_id = meetup.channel_id
            payload = {"t": "meetup.started", "meetup": meetup.model_dump(by_alias=True)}
            after.add(lambda: hub.to_channel(channel_id, payload))
    return meetup


@router.get("/{meetup_id}", response_model=MeetupOut)
async def get_meetup(
    meetup_id: IdParam, user: SessionUser = Depends(current_user)
) -> MeetupOut:
    async with session_scope() as session:
        return await _visible(session, user, meetup_id)


@router.post("/{meetup_id}/token", response_model=MeetupTokenOut)
async def get_meetup_token(
    meetup_id: IdParam, user: SessionUser = Depends(current_user)
) -> MeetupTokenOut:
    async with session_scope() as session:
        meetup = await _visible(session, user, meetup_id)
    return await meetups.generate_token(user.workspace_id, user.id, user.display_name, meetup)


@router.post("/{meetup_id}/end", response_model=MeetupOut)
async def end_meetup(
    meetup_id: IdParam, user: SessionUser = Depends(current_user)
) -> MeetupOut:
    async with transaction() as (session, after):
        meetup = await _visible(session, user, meetup_id)
        if meetup.created_by != user.id and not user.is_admin:
            raise forbidden("Only the person who started a meetup, or an admin, can end it.")
        meetup = await meetups.end(session, user.workspace_id, meetup_id)
        if meetup.channel_id:
            channel_id = meetup.channel_id
            payload = {"t": "meetup.ended", "meetupId": meetup.id}
            after.add(lambda: hub.to_channel(channel_id, payload))
    return meetup
