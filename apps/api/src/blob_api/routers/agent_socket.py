"""The endpoint a desktop agent dials.

Thin on purpose, the same way `realtime/ws.py` is thin: it authenticates, hands the
connection to `plugins.gateway`, and translates frames. The routing, the claiming and the
cross-process work all live in the gateway, so this file has no opinion about how a run
finds the process holding the socket.

**Authentication is the app's own bot token**, resolved by the same `resolve_bot` the
callback API uses — so a disabled app cannot hold a connection, and a revoked token drops
one at the next reconnect. Two ways to present it, because a desktop agent is not a
browser and a browser cannot set headers:

* `Authorization: Bearer …`, preferred.
* A first frame of `{"t": "auth", "token": "…"}`, for clients that cannot.

Deliberately **not** a query parameter. `?token=` is the third thing every client library
supports and the first thing every reverse proxy writes to an access log.

The connection accepts no writes to the workspace. An agent that wants to post a message
outside a run uses the callback API with the same token, where the scope checks live —
this socket carries runs and their answers, nothing else.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db.engine import transaction
from ..lib.errors import AppError
from ..plugins import gateway, registry
from ..plugins.auth import BotCaller, resolve_bot

log = logging.getLogger("blob.agents.socket")

router = APIRouter()

#: How long the agent has to present a token before the socket is dropped. Generous for a
#: laptop waking up, short enough that an unauthenticated socket is not a resource.
AUTH_DEADLINE_SEC = 10.0

#: Close codes. 1008 is "policy violation", which is what every WebSocket client already
#: surfaces as "the server refused me" rather than as a network error worth retrying fast.
CLOSE_UNAUTHORIZED = 1008
CLOSE_BAD_FRAME = 1003


@router.websocket("/ws/agent")
async def agent_socket(websocket: WebSocket) -> None:
    await websocket.accept()

    bot = await _authenticate(websocket)
    if bot is None:
        return

    async def send(payload: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(payload))

    await send(
        {
            "t": "ready",
            "pluginId": bot.plugin_id,
            "botUserId": bot.user_id,
            "name": bot.name,
            "scopes": sorted(bot.scopes),
        }
    )

    try:
        async with gateway.AgentConnection(bot.plugin_id, send):
            log.info("agent %s connected", bot.slug)
            await _read_loop(websocket, bot, send)
    except WebSocketDisconnect:
        pass
    finally:
        log.info("agent %s disconnected", bot.slug)
        with contextlib.suppress(Exception):
            await websocket.close()


def _bearer(header: str) -> str | None:
    """The token out of an Authorization header, or None.

    A second copy of the one in `plugins/auth`, which takes a `Request` — and a
    WebSocket is not one. Four lines duplicated beats threading a protocol through two
    call sites to share them.
    """
    prefix = "bearer "
    if header[: len(prefix)].lower() != prefix:
        return None
    return header[len(prefix) :].strip() or None


async def _authenticate(websocket: WebSocket) -> BotCaller | None:
    """Resolve the token from the header, or from one frame, or drop the socket."""
    token = _bearer(websocket.headers.get("authorization", ""))

    if token is None:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_DEADLINE_SEC)
        except (TimeoutError, WebSocketDisconnect):
            with contextlib.suppress(Exception):
                await websocket.close(code=CLOSE_UNAUTHORIZED)
            return None
        try:
            frame = json.loads(raw)
        except ValueError:
            with contextlib.suppress(Exception):
                await websocket.close(code=CLOSE_BAD_FRAME)
            return None
        if frame.get("t") != "auth" or not isinstance(frame.get("token"), str):
            with contextlib.suppress(Exception):
                await websocket.close(code=CLOSE_UNAUTHORIZED)
            return None
        token = frame["token"]

    try:
        bot = await resolve_bot(token)
    except AppError:
        # Which of "unknown token", "revoked" and "app disabled" it was is not the
        # caller's business, exactly as on the HTTP path.
        with contextlib.suppress(Exception):
            await websocket.close(code=CLOSE_UNAUTHORIZED)
        return None

    return bot


async def _read_loop(
    websocket: WebSocket,
    bot: BotCaller,
    send: Any,
) -> None:
    while True:
        raw = await websocket.receive_text()
        if len(raw) > gateway.MAX_FRAME_BYTES:
            await send({"t": "error", "message": "That frame is larger than we will read."})
            continue
        try:
            frame = json.loads(raw)
        except ValueError:
            await send({"t": "error", "message": "That frame is not JSON."})
            continue
        if not isinstance(frame, dict):
            continue

        kind = frame.get("t")

        if kind == "ping":
            await send({"t": "pong"})

        elif kind == "hello":
            # The import, such as it is. Connecting *is* registering: an agent says what
            # it is on the way in rather than being described by hand in a console it has
            # never heard of. What it may *do* is not up for self-declaration — scopes
            # stay whatever an admin approved, or this would be an app granting itself
            # permissions by asserting them.
            async with transaction() as (session, _):
                await registry.describe(
                    session,
                    plugin_id=bot.plugin_id,
                    workspace_id=bot.workspace_id,
                    name=frame.get("name"),
                    description=frame.get("description"),
                    version=frame.get("version"),
                )
            await send({"t": "hello_ok"})

        elif kind == "event":
            run_id = frame.get("runId")
            event = frame.get("event")
            if isinstance(run_id, str) and isinstance(event, dict):
                await gateway.relay_event(run_id, event)

        elif kind == "done":
            run_id = frame.get("runId")
            if isinstance(run_id, str):
                await gateway.relay_end(run_id)

        else:
            # Unknown frame types are ignored rather than fatal, for the reason
            # `plugins/agui.py` gives about unknown AG-UI events: this protocol will gain
            # frames, and a strict reader turns next month's addition into a dead agent.
            continue
