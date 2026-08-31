"""The socket a browser terminal talks over.

Thin, like the other two socket endpoints: authenticate, ask the service whether this is
allowed, then pump bytes between a PTY and a WebSocket until one of them stops. Nothing
here decides who may open a terminal — `services/agent_shell.py` does — and nothing here
knows how a terminal is obtained.

**Authentication is the ordinary session cookie.** `SessionMiddleware` resolves it for
websocket scopes too, so the person on the far end is the signed-in admin and not a token
that had to be minted, pasted somewhere, and then remembered about. A terminal is a
first-party console feature, and giving it a credential of its own would mean a
long-lived secret that opens a root shell.

The frames are JSON with a `t` discriminator, matching the rest of Blob's socket
protocols. Terminal output is *not* base64: it is decoded incrementally to text and sent
as text, because the alternative is a third of the bandwidth wasted on encoding a stream
that is almost entirely printable characters.
"""

from __future__ import annotations

import asyncio
import codecs
import contextlib
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect

from ..config import settings
from ..lib.auth import SessionUser, current_user
from ..lib.errors import AppError, forbidden
from ..plugins.shell import ShellSession, clamp_size
from ..services import agent_shell as shell_service
from ..services.audit import Actor

log = logging.getLogger("blob.agents.shell")

router = APIRouter()

CLOSE_UNAUTHORIZED = 1008

#: Terminals open in this process. A cap rather than a queue: waiting for a slot would
#: show an operator a blank terminal that might start working, which is worse than being
#: told there are already too many.
_open: set[str] = set()


@router.get("/api/agents/terminal/{user_id}")
async def agent_terminal_target(
    user_id: str, request: Request, user: SessionUser = Depends(current_user)
) -> dict[str, str]:
    """Which agent a DM's terminal would open into, or why there isn't one.

    `/cli` needs an answer before it opens anything: a panel that appears and then shows
    a close code is worse than a command that says why it did nothing. The socket
    re-resolves this at connect time — this is the same question asked early, never the
    authority for it, so nothing here is a place to get the gate wrong once.
    """
    if not user.is_admin:
        raise forbidden("Only an administrator can open a terminal in an agent.")

    actor = Actor(
        id=user.id,
        workspace_id=user.workspace_id,
        ip=request.client.host if request.client else None,
    )
    target = await shell_service.resolve_for_bot_user(actor, user_id)
    return {"pluginId": target.plugin_id, "agentName": target.name}


@router.websocket("/ws/admin/agents/{plugin_id}/shell")
async def agent_shell_socket(websocket: WebSocket, plugin_id: str) -> None:
    user: SessionUser | None = getattr(websocket.state, "user", None)
    if user is None or not user.is_admin:
        # Refused before accepting. Starlette turns this into an HTTP error, which is what
        # a browser reports as a failed upgrade rather than as a connection that opened
        # and then closed for no stated reason.
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    actor = Actor(
        id=user.id,
        workspace_id=user.workspace_id,
        ip=websocket.client.host if websocket.client else None,
    )

    # Resolved *before* accepting, so a refusal is an error the console can render as
    # text. After the upgrade the only thing left is a close code, and "1008" is not an
    # explanation of why an agent has no terminal.
    try:
        target = await shell_service.resolve(actor, plugin_id)
    except AppError as exc:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason=exc.message[:120])
        return

    await websocket.accept()

    if len(_open) >= settings.AGENT_SHELL_MAX_SESSIONS:
        await _send(websocket, {"t": "error", "message": "Too many terminals are open."})
        await websocket.close()
        return

    cols, rows = clamp_size(
        websocket.query_params.get("cols", 80), websocket.query_params.get("rows", 24)
    )

    key = f"{user.id}:{plugin_id}:{time.monotonic()}"
    _open.add(key)
    try:
        async with shell_service.open_session(actor, target, cols=cols, rows=rows) as session:
            await _send(websocket, {"t": "ready", "agent": target.name})
            await _pump(websocket, session)
    except AppError as exc:
        await _send(websocket, {"t": "error", "message": exc.message})
    except WebSocketDisconnect:
        pass
    finally:
        _open.discard(key)
        with contextlib.suppress(Exception):
            await websocket.close()


async def _pump(websocket: WebSocket, session: ShellSession) -> None:
    """Bytes both ways until either end stops, then stop the other."""
    last_input = time.monotonic()
    started = last_input

    def touched() -> None:
        nonlocal last_input
        last_input = time.monotonic()

    reader = asyncio.create_task(_from_agent(websocket, session))
    writer = asyncio.create_task(_from_browser(websocket, session, touched))
    idle = asyncio.create_task(_watch_idle(lambda: last_input, started))

    try:
        done, pending = await asyncio.wait(
            {reader, writer, idle}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        # Awaited rather than abandoned: a cancelled task that is never awaited logs
        # "Task exception was never retrieved" at process exit, which is noise in a log
        # that is otherwise worth reading.
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect):
                task.result()
    finally:
        for task in (reader, writer, idle):
            task.cancel()

    await _send(websocket, {"t": "exit", "code": session.exit_status})


async def _from_agent(websocket: WebSocket, session: ShellSession) -> None:
    """PTY output to the browser, decoded as it arrives.

    Incremental, and this is the whole reason the decoder is held across reads: a PTY
    splits wherever the read boundary falls, so a multi-byte character — an accented
    letter, a box-drawing rule, the emoji in a spinner — routinely arrives in two pieces.
    Decoding each read on its own raises on the first half and takes the terminal down
    with it, and `errors="replace"` alone would silently corrupt the character instead.
    """
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    while True:
        chunk = await session.read()
        if not chunk:
            text = decoder.decode(b"", final=True)
            if text:
                await _send(websocket, {"t": "out", "data": text})
            return
        text = decoder.decode(chunk)
        if text:
            await _send(websocket, {"t": "out", "data": text})


async def _from_browser(websocket: WebSocket, session: ShellSession, touched: Any) -> None:
    """Keystrokes and window sizes from the console."""
    while True:
        raw = await websocket.receive_text()
        try:
            frame = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(frame, dict):
            continue

        kind = frame.get("t")
        if kind == "in":
            data = frame.get("data")
            if isinstance(data, str) and data:
                touched()
                await session.write(data.encode())
        elif kind == "resize":
            touched()
            session.resize(*clamp_size(frame.get("cols"), frame.get("rows")))
        elif kind == "ping":
            await _send(websocket, {"t": "pong"})
        # Anything else is ignored rather than fatal. This protocol will gain frames, and
        # a strict reader turns next month's addition into a terminal that will not open.


async def _watch_idle(last_input: Any, started: float) -> None:
    """Close a session nobody is using, and one that has simply gone on too long.

    An open terminal is a root shell in a container held by a browser tab, and a tab
    stays open for days. Both bounds exist because they catch different things: the idle
    one catches somebody who walked away, the absolute one catches a tab that is being
    kept alive by something that is not a person.
    """
    while True:
        await asyncio.sleep(15)
        now = time.monotonic()
        if now - last_input() >= settings.AGENT_SHELL_IDLE_SEC:
            log.info("closing an idle agent terminal")
            return
        if now - started >= settings.AGENT_SHELL_MAX_SEC:
            log.info("closing an agent terminal that reached its time limit")
            return


async def _send(websocket: WebSocket, payload: dict[str, Any]) -> None:
    with contextlib.suppress(Exception):
        await websocket.send_text(json.dumps(payload))
