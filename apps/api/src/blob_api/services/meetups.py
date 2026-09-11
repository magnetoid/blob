from __future__ import annotations

from datetime import UTC, datetime

from livekit import api
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.models import Meetup
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..schemas.base import iso, require_iso
from ..schemas.meetups import MeetupCreate, MeetupOut, MeetupTokenOut


def to_meetup(row: Meetup) -> MeetupOut:
    return MeetupOut(
        id=row.id,
        workspace_id=row.workspace_id,
        channel_id=row.channel_id,
        created_by=row.created_by,
        name=row.name,
        status=row.status,
        created_at=require_iso(row.created_at),
        ended_at=iso(row.ended_at),
    )


async def create(
    session: AsyncSession,
    workspace_id: str,
    user_id: str,
    input_: MeetupCreate,
) -> MeetupOut:
    meetup = Meetup(
        id=new_id(),
        workspace_id=workspace_id,
        channel_id=input_.channel_id,
        created_by=user_id,
        name=input_.name,
        status="active",
    )
    session.add(meetup)
    await session.flush()
    return to_meetup(meetup)


async def get(session: AsyncSession, workspace_id: str, meetup_id: str) -> MeetupOut:
    row = (
        await session.execute(
            select(Meetup).where(Meetup.workspace_id == workspace_id, Meetup.id == meetup_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise not_found("meetup_not_found")
    return to_meetup(row)


async def end(session: AsyncSession, workspace_id: str, meetup_id: str) -> MeetupOut:
    row = (
        await session.execute(
            update(Meetup)
            .where(Meetup.workspace_id == workspace_id, Meetup.id == meetup_id)
            .values(status="ended", ended_at=datetime.now(UTC))
            .returning(Meetup)
        )
    ).scalar_one_or_none()
    if not row:
        raise not_found("meetup_not_found")
    return to_meetup(row)


async def generate_token(
    workspace_id: str,
    user_id: str,
    user_display_name: str,
    meetup: MeetupOut,
) -> MeetupTokenOut:
    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET or not settings.LIVEKIT_URL:
        # Fallback for dev if not configured, though in production this should be set
        if not settings.is_prod:
            # Just return a dummy for now to allow UI dev
            return MeetupTokenOut(token="dummy-token", url="ws://localhost:7880")
        raise bad_request("livekit_not_configured")

    if meetup.status != "active":
        raise bad_request("meetup_ended")

    # Use meetup ID as room name
    room_name = meetup.id

    token = (
        api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(user_id)
        .with_name(user_display_name)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )

    return MeetupTokenOut(token=token, url=settings.LIVEKIT_URL)
