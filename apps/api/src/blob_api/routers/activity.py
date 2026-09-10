"""Activity feed: mentions, reactions, and stored extra kinds."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ..db.engine import session_scope
from ..lib.auth import SessionUser, current_user
from ..schemas.base import CamelModel, require_iso
from ..schemas.models import Message
from ..services import activity as activity_service

router = APIRouter(tags=["activity"])


class ActivityItemOut(CamelModel):
    #: "mention", "reaction", "reminder", or "recap".
    kind: str
    at: str
    #: Who did it: who named you, or who reacted.
    actor_id: str | None = None
    #: The emoji, on a reaction.
    emoji: str | None = None
    message: Message


class ActivityOut(CamelModel):
    items: list[ActivityItemOut]
    next_cursor: str | None = None


@router.get("/api/activity", response_model=ActivityOut)
async def activity(
    kind: Annotated[str, Query(pattern="^(all|mention|reaction|reminder|recap)$")] = "all",
    limit: Annotated[int, Query(ge=1, le=50)] = 30,
    cursor: Annotated[str | None, Query(max_length=120)] = None,
    user: SessionUser = Depends(current_user),
) -> ActivityOut:
    """Mentions of you, reactions to what you wrote, and stored extra kinds."""
    async with session_scope() as session:
        items, next_cursor = await activity_service.feed(
            session,
            workspace_id=user.workspace_id,
            user_id=user.id,
            kind=kind,
            limit=limit,
            cursor=activity_service.ActivityCursor.decode(cursor) if cursor else None,
        )
    return ActivityOut(
        items=[
            ActivityItemOut(
                kind=item.kind,
                at=require_iso(item.at),
                actor_id=item.actor_id,
                emoji=item.emoji,
                message=item.message,
            )
            for item in items
        ],
        next_cursor=next_cursor.encode() if next_cursor else None,
    )
