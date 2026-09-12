"""Meetups: Blob mints the token, LiveKit carries the media.

Written on `text()` like every other service. This was the one file on the ORM, and the
only reason the drift grep in CLAUDE.md had a hit to explain.
"""

from __future__ import annotations

from typing import Any

from livekit import api
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..schemas.base import iso, require_iso
from ..schemas.meetups import MeetupCreate, MeetupOut, MeetupTokenOut

MEETUP_COLUMNS = "id, workspace_id, channel_id, created_by, name, status, created_at, ended_at"


def to_meetup(row: Any) -> MeetupOut:
    return MeetupOut(
        id=str(row.id),
        workspace_id=str(row.workspace_id),
        channel_id=str(row.channel_id) if row.channel_id else None,
        created_by=str(row.created_by),
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
    row = (
        await session.execute(
            text(
                f"""
                INSERT INTO meetups (id, workspace_id, channel_id, created_by, name, status)
                VALUES (:id, :ws, cast(:channel_id AS uuid), :created_by, :name, 'active')
                RETURNING {MEETUP_COLUMNS}
                """
            ),
            {
                "id": new_id(),
                "ws": workspace_id,
                "channel_id": input_.channel_id,
                "created_by": user_id,
                "name": input_.name,
            },
        )
    ).fetchone()
    assert row is not None
    return to_meetup(row)


async def get(session: AsyncSession, workspace_id: str, meetup_id: str) -> MeetupOut:
    row = (
        await session.execute(
            text(f"SELECT {MEETUP_COLUMNS} FROM meetups WHERE workspace_id = :ws AND id = :id"),
            {"ws": workspace_id, "id": meetup_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("meetup_not_found")
    return to_meetup(row)


async def end(session: AsyncSession, workspace_id: str, meetup_id: str) -> MeetupOut:
    row = (
        await session.execute(
            text(
                f"""
                UPDATE meetups SET status = 'ended', ended_at = now()
                 WHERE workspace_id = :ws AND id = :id
                RETURNING {MEETUP_COLUMNS}
                """
            ),
            {"ws": workspace_id, "id": meetup_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("meetup_not_found")
    return to_meetup(row)


async def generate_token(
    workspace_id: str,
    user_id: str,
    user_display_name: str,
    meetup: MeetupOut,
) -> MeetupTokenOut:
    # No LiveKit is a supported state, and it says so in every environment. A fake token
    # for dev was the alternative, and a token that fails at connect time looks exactly
    # like a bug in the app; a typed error is something the client can explain.
    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET or not settings.LIVEKIT_URL:
        raise bad_request("LiveKit is not configured.", code="livekit_not_configured")

    if meetup.status != "active":
        raise bad_request("This meetup has ended.", code="meetup_ended")

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
