"""WebSocket endpoint.

Deliberately thin: it authenticates, subscribes the connection to the user's channels,
and relays events. It accepts no writes — every mutation goes through REST, so a socket
outage degrades to "no live updates", never to lost data.

This module imports nothing from routers/, so it can move to its own process unchanged.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.auth import SessionUser
from ..lib.ids import looks_like_id, new_id
from . import hub, presence
from .protocol import HEARTBEAT_MS, TYPING_THROTTLE_MS

log = logging.getLogger("blob.ws")

router = APIRouter()

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
    conn = hub.new_connection(new_id(), user.id, user.workspace_id)
    hub.register(conn)

    async with session_scope() as session:
        # Joined to `channels` on the session's workspace, not keyed on user id alone.
        # A `channel_members` row can only be created for the channel's own workspace
        # now, but rows planted before that check existed cannot be removed by the person
        # they were planted on — `leave` 404s them, and there is no admin route for it.
        # This is what stops such a row ever becoming a live feed again.
        rows = (
            await session.execute(
                text(
                    """
                    SELECT cm.channel_id
                      FROM channel_members cm
                      JOIN channels c ON c.id = cm.channel_id
                     WHERE cm.user_id = :user_id AND c.workspace_id = :workspace_id
                    """
                ),
                {"user_id": user.id, "workspace_id": user.workspace_id},
            )
        ).fetchall()
    hub.subscribe_channels(conn, [row.channel_id for row in rows])

    conn.send({"t": "hello", "userId": user.id, "serverTime": _now_iso()})
    await presence.track_connection(user.id, conn.id)
    # `mark_present`, not `mark_active`: reconnecting is not a decision to stop being away.
    await presence.mark_present(user.id)

    writer = asyncio.create_task(_writer(websocket, conn))
    # The reader ends when the client goes away; the closed event ends when *we* drop the
    # connection, which the hub does when a client falls too far behind. Waiting on the
    # reader alone left those connections registered and silent forever, because a slow
    # client is still a talking client and the read never returns.
    reader = asyncio.create_task(_reader(websocket, conn, user))
    dropped = asyncio.create_task(conn.closed_event.wait())
    try:
        await asyncio.wait({reader, dropped}, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        conn.close()
        for task in (reader, dropped, writer):
            task.cancel()
        for task in (reader, dropped, writer):
            # `Exception` and not just the two expected ones. `asyncio.wait` above stores
            # the reader's exception rather than raising it, so awaiting the task here is
            # where it surfaces — and anything unexpected used to escape the finally
            # *before* the four lines below, leaving the connection registered in the
            # hub's fan-out maps for the life of the process and never announcing the
            # person offline. One malformed frame from any authenticated client was
            # enough. A socket coming down is the wrong place to re-raise: log it and
            # finish the teardown.
            try:
                await task
            except (asyncio.CancelledError, WebSocketDisconnect):
                pass
            except Exception:
                log.warning("socket task ended badly for %s", user.id, exc_info=True)
        hub.unregister(conn)
        # Close the socket rather than leaving it open behind a cancelled reader, so the
        # client's onclose fires and its existing reconnect-and-resync path runs.
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await websocket.close()
        # Deregister before the offline check, or our own entry keeps us "online".
        await presence.untrack_connection(user.id, conn.id)
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

        # `receive_json` is a bare `json.loads`, so a frame of `"x"` or `[1]` parses
        # cleanly and is not a dict — `frame.get` would raise AttributeError.
        if not isinstance(frame, dict):
            continue

        last_seen = time.monotonic()
        kind = frame.get("t")

        if kind == "ping":
            conn.send({"t": "pong"})
            await presence.refresh_connection(user.id, conn.id)
            await presence.mark_present(user.id)

        elif kind == "presence.sub":
            # Resolved against the caller's workspace before anything is watched. The
            # frame is a raw list of ids from the client, and ids are not secret — they
            # ride in message payloads and survive being removed from a workspace. Without
            # this, a session could watch up to 500 people in other tenants and receive
            # every active/away/offline transition: attendance telemetry on named
            # strangers. Silently dropped rather than refused, because whether an id names
            # anybody is exactly what must not be answered.
            # Shape-checked before the SQL, which casts to `uuid[]`: an id that is not
            # one raises out of the reader, and an exception in the reader is a
            # connection that never unregisters. `IdParam` guards path params and
            # request bodies; a socket frame arrives without a schema layer to refuse it.
            # Dropped rather than refused, in keeping with the resolution below —
            # whether an id names anybody is what must not be answered.
            raw = frame.get("userIds")
            asked = (
                [uid for uid in raw if looks_like_id(uid)][:MAX_PRESENCE_SUBS]
                if isinstance(raw, list)
                else []
            )
            user_ids = await _visible_users(asked, user.workspace_id) if asked else []
            hub.set_presence_subs(conn, user_ids)
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
            await presence.set_focus(user.id, conn.id, conn.focused_channel_id)

        if time.monotonic() - last_seen > DEAD_AFTER_SEC:
            return


async def _visible_users(user_ids: list[str], workspace_id: str) -> list[str]:
    """Which of these ids the caller is allowed to know anything about.

    Scoped inside the query rather than by comparing afterwards, so there is one place
    the boundary lives. Returns a subset — never an error — because refusing a specific
    id would confirm it names somebody.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id FROM users
                     WHERE id = ANY(cast(:ids AS uuid[])) AND workspace_id = :ws
                    """
                ),
                {"ids": user_ids, "ws": workspace_id},
            )
        ).fetchall()
    return [str(row.id) for row in rows]


def _now_iso() -> str:
    from datetime import UTC, datetime

    from ..schemas.base import require_iso

    return require_iso(datetime.now(UTC))


__all__ = ["router"]
