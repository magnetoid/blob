"""WebSocket endpoint.

Deliberately thin: it authenticates, subscribes the connection to the user's channels,
and relays events. It accepts no writes — every mutation goes through REST, so a socket
outage degrades to "no live updates", never to lost data.

This module imports nothing from routers/, so it can move to its own process unchanged.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.auth import SessionUser
from ..lib.ids import new_id
from . import hub, presence

router = APIRouter()

#: Client heartbeat interval; the server drops a connection after two missed beats.
HEARTBEAT_MS = 25_000
#: A client may send at most one typing frame per this interval.
TYPING_THROTTLE_MS = 3_000
DEAD_AFTER_SEC = (HEARTBEAT_MS * 2 + 5_000) / 1000
#: Presence subscriptions are per-view; cap them so one client cannot ask for everyone.
MAX_PRESENCE_SUBS = 500


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    user: SessionUser | None = getattr(websocket.state, "user", None)
    if user is None:
        # Starlette closes pre-accept with an HTTP error; the client treats any failed
        # connect the same way and retries with backoff.
        await websocket.close(code=1008)
        return

    await websocket.accept()
    conn = hub.new_connection(new_id(), user.id)
    hub.register(conn)

    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT channel_id FROM channel_members WHERE user_id = :user_id"),
                {"user_id": user.id},
            )
        ).fetchall()
    hub.subscribe_channels(conn, [row.channel_id for row in rows])

    conn.send({"t": "hello", "userId": user.id, "serverTime": _now_iso()})
    await presence.mark_active(user.id)

    writer = asyncio.create_task(_writer(websocket, conn))
    try:
        await _reader(websocket, conn, user)
    except WebSocketDisconnect:
        pass
    finally:
        conn.close()
        writer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await writer
        hub.unregister(conn)
        await presence.mark_offline(user.id)


async def _writer(websocket: WebSocket, conn: hub.Connection) -> None:
    """Drain the connection's outbox.

    The hub queues events synchronously so that services never await a socket write;
    this task is the only thing that actually touches the wire.
    """
    while True:
        event = await conn.outbox.get()
        try:
            await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            return


async def _reader(websocket: WebSocket, conn: hub.Connection, user: SessionUser) -> None:
    last_seen = time.monotonic()
    last_typing = 0.0

    while True:
        try:
            frame: dict[str, Any] = await asyncio.wait_for(
                websocket.receive_json(), timeout=DEAD_AFTER_SEC
            )
        except TimeoutError:
            return
        except ValueError:
            continue  # Not JSON; ignore rather than drop the connection.

        last_seen = time.monotonic()
        kind = frame.get("t")

        if kind == "ping":
            conn.send({"t": "pong"})
            await presence.mark_active(user.id)

        elif kind == "presence.sub":
            user_ids = [str(uid) for uid in frame.get("userIds", [])][:MAX_PRESENCE_SUBS]
            conn.presence_subs = set(user_ids)
            states = await presence.get_presence(user_ids)
            for subject, state in states.items():
                conn.send({"t": "presence", "userId": subject, "state": state})

        elif kind == "typing":
            channel_id = frame.get("channelId")
            now = time.monotonic()
            if (
                not channel_id
                or channel_id not in conn.channel_ids
                or (now - last_typing) * 1000 < TYPING_THROTTLE_MS
            ):
                continue
            last_typing = now
            await presence.set_typing(channel_id, user.id, frame.get("threadRootId"))

        elif kind == "channel.focus":
            conn.focused_channel_id = frame.get("channelId")

        if time.monotonic() - last_seen > DEAD_AFTER_SEC:
            return


def _now_iso() -> str:
    from datetime import UTC, datetime

    from ..schemas.base import require_iso

    return require_iso(datetime.now(UTC))


__all__ = ["router"]
