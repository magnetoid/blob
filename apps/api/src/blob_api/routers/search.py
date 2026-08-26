"""Search and reconnect sync."""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.auth import SessionUser, current_user
from ..lib.rate_limit import consume
from ..realtime.protocol import MAX_REPLAY_PER_CHANNEL
from ..schemas.base import CamelModel
from ..schemas.models import ChannelWithState, Message, ReadStateOut
from ..services import channels as channel_service
from ..services import read_state as read_state_service
from ..services.search import parse_query, search
from ..services.serialize import MESSAGE_SELECT, to_message

router = APIRouter(tags=["search"])


class ParsedOut(CamelModel):
    text: str
    from_: str | None = None
    in_: str | None = None
    has: str | None = None
    before: str | None = None
    after: str | None = None


class SearchOut(CamelModel):
    messages: list[Message]
    total: int
    parsed: dict[str, Any]


class SyncOut(CamelModel):
    #: Channels where the gap was too large to replay; refetch their tail.
    resync_channel_ids: list[str]
    messages: list[Message]
    channels: list[ChannelWithState]
    read_states: list[ReadStateOut]


@router.get("/api/search", response_model=SearchOut)
async def search_messages(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    user: SessionUser = Depends(current_user),
) -> SearchOut:
    await consume("search", user.id)
    parsed = parse_query(q)
    # Modifiers name people and channels by label; the client shows what it parsed.
    parsed_payload = {
        "text": parsed.text,
        "from": parsed.author,
        "in": parsed.channel,
        "has": parsed.has,
        "before": parsed.before.date().isoformat() if parsed.before else None,
        "after": parsed.after.date().isoformat() if parsed.after else None,
    }

    if not parsed.text:
        return SearchOut(messages=[], total=0, parsed=parsed_payload)

    async with session_scope() as session:
        author_id = channel_id = None
        if parsed.author:
            row = (
                await session.execute(
                    text(
                        """
                        SELECT id FROM users
                         WHERE workspace_id = :ws AND lower(display_name) = lower(:name)
                        """
                    ),
                    {"ws": user.workspace_id, "name": parsed.author},
                )
            ).fetchone()
            author_id = row.id if row else None
        if parsed.channel:
            row = (
                await session.execute(
                    text(
                        """
                        SELECT id FROM channels
                         WHERE workspace_id = :ws AND lower(name) = lower(:name)
                        """
                    ),
                    {"ws": user.workspace_id, "name": parsed.channel},
                )
            ).fetchone()
            channel_id = row.id if row else None

        messages, total = await search(
            session,
            workspace_id=user.workspace_id,
            user_id=user.id,
            query=parsed.text,
            author_id=author_id,
            channel_id=channel_id,
            before=parsed.before,
            after=parsed.after,
            has=parsed.has,
            limit=limit,
        )

    return SearchOut(messages=messages, total=total, parsed=parsed_payload)


@router.get("/api/sync", response_model=SyncOut)
async def sync(cursors: str | None = None, user: SessionUser = Depends(current_user)) -> SyncOut:
    """Reconnect delta.

    The client sends its last-seen message id per channel; we return what it missed.
    Past MAX_REPLAY_PER_CHANNEL we say "refetch this one" instead of replaying — cheaper
    than streaming thousands of rows to a client that has been asleep.
    """
    try:
        parsed_cursors: dict[str, str] = json.loads(cursors) if cursors else {}
        if not isinstance(parsed_cursors, dict):
            parsed_cursors = {}
    except (ValueError, TypeError):
        parsed_cursors = {}

    async with session_scope() as session:
        channels = await channel_service.list_for_user(session, user.id, user.workspace_id)
        resync: list[str] = []
        messages: list[Message] = []

        for channel in channels:
            if channel.membership is None:
                continue
            cursor = parsed_cursors.get(channel.id)
            if not cursor:
                continue
            if channel.last_message_id and channel.last_message_id <= cursor:
                continue

            rows = (
                await session.execute(
                    text(
                        f"""
                        SELECT {MESSAGE_SELECT} FROM messages m
                         WHERE m.channel_id = :channel_id AND m.id > cast(:cursor AS uuid)
                         ORDER BY m.id ASC LIMIT :limit
                        """
                    ),
                    {
                        "channel_id": channel.id,
                        "cursor": cursor,
                        "limit": MAX_REPLAY_PER_CHANNEL + 1,
                    },
                )
            ).fetchall()

            if len(rows) > MAX_REPLAY_PER_CHANNEL:
                resync.append(channel.id)
                continue
            messages.extend(to_message(row) for row in rows)

        read_states = await read_state_service.list_for_user(session, user.id)

    return SyncOut(
        resync_channel_ids=resync,
        messages=messages,
        channels=channels,
        read_states=read_states,
    )


__all__ = ["router"]
