"""Hold Blob's agent socket from a laptop, and forward runs to a local AG-UI server.

This is the client half of ADR 0012, and the reason it exists is that an agent on a
desktop has no address. It is behind NAT, on a network this server cannot see, and asleep
half the day — so Blob cannot call it. It dials Blob instead and holds a WebSocket, and
runs go down that pipe. Only the *transport* reverses: the agent still answers runs it did
not start, and the same `Fold` reads the same events.

**It bridges rather than implements.** A run arrives, and this forwards it to an AG-UI
server already running on the same machine — `POST /v1/agui` for Janus — signed exactly as
Blob signs an HTTP delivery, then relays the event stream back frame by frame. Nothing
here knows what an agent *is*. That is the whole point: the agent's own tested AG-UI path
answers, unmodified, and this is a hundred lines of plumbing rather than a second
implementation of a protocol that already works.

It follows that this works for any AG-UI server, not only Janus. Point `AGENT_AGUI_URL` at
whatever speaks the protocol locally.

Run it beside the agent:

    export BLOB_URL=https://chat.imbamarketing.com
    export BLOB_BOT_TOKEN=blob-bot-...        # from Blob, when you add the app
    export AGENT_AGUI_URL=http://127.0.0.1:8642/v1/agui
    export BLOB_SIGNING_SECRET=...            # the same secret the agent verifies with
    python -m blob_api.tools.agent_bridge

The token is the app's **bot token**, minted by Blob when the app is registered. It is
deliberately not a shared server-wide secret: it identifies one app, carries that app's
scopes, is revocable on its own, and stops working the moment an admin disables the app —
none of which is true of a single `AGENT_WEBSOCKET_TOKEN` every agent would share.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import os
import random
import sys
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
import websockets

log = logging.getLogger("blob.bridge")

#: Matches the server's `gateway.MAX_FRAME_BYTES`. A frame larger than this is refused at
#: the other end, so there is no point assembling one.
MAX_FRAME_BYTES = 512 * 1024

#: The server answers `{"t": "pong"}`. This is well inside any proxy's idle timeout, and
#: a socket that has gone away is discovered by the send failing rather than by a timer.
PING_INTERVAL_SEC = 25.0

#: How long to wait for the local agent, end to end. The server gives up at
#: `AGUI_TIMEOUT_SEC + AGUI_READ_TIMEOUT_SEC` (150s by default); finishing first means the
#: person gets the agent's own error rather than a generic timeout.
AGENT_TIMEOUT_SEC = 140.0

#: How many runs may be in flight at once. A laptop is not a server, and an agent asked
#: five questions in five seconds should queue rather than thrash.
MAX_CONCURRENT_RUNS = 3

RECONNECT_MIN_SEC = 1.0
RECONNECT_MAX_SEC = 60.0


class Config:
    """Everything from the environment, checked once so a typo fails at startup."""

    def __init__(self) -> None:
        self.blob_url = _require("BLOB_URL").rstrip("/")
        self.token = _require("BLOB_BOT_TOKEN")
        self.agui_url = _require("AGENT_AGUI_URL")
        # Optional: an agent that verifies no signature simply ignores the headers. Blob
        # always sends them, so the default is to send them here too.
        self.signing_secret = os.getenv("BLOB_SIGNING_SECRET", "")
        self.name = os.getenv("AGENT_NAME") or None
        self.description = os.getenv("AGENT_DESCRIPTION") or None
        self.version = os.getenv("AGENT_VERSION") or None

    @property
    def socket_url(self) -> str:
        """The `/ws/agent` URL, with the scheme swapped for its WebSocket equivalent."""
        parts = urlsplit(self.blob_url)
        scheme = "wss" if parts.scheme == "https" else "ws"
        return urlunsplit((scheme, parts.netloc, "/ws/agent", "", ""))


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set. See the module docstring for what it wants.")
    return value


def _sign(secret: str, timestamp: int, body: bytes) -> str:
    """Blob's scheme, which is Slack's: `v0=hex(hmac_sha256("v0:{ts}:{body}"))`.

    Reimplemented in ten lines rather than imported, so this file can be copied to the
    machine the agent runs on and executed with nothing but `httpx` and `websockets`.
    """
    base = f"v0:{timestamp}:".encode() + body
    return "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()


async def _sse_events(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """The JSON objects out of a `text/event-stream`.

    Only `data:` lines are read. AG-UI's discriminator is the JSON `type` field rather
    than the SSE event name, so an agent that sets both cannot disagree with itself.
    """
    buffer = ""
    data: list[str] = []
    async for chunk in response.aiter_text():
        buffer += chunk
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.rstrip("\r")
            if line.startswith(":"):
                continue  # a comment, and the usual shape of a keep-alive
            if line:
                name, _, value = line.partition(":")
                if name == "data":
                    data.append(value[1:] if value.startswith(" ") else value)
                continue
            if data:
                raw, data = "\n".join(data), []
                with contextlib.suppress(ValueError):
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        yield parsed
    # Whatever arrived without a trailing newline is still a line, and whatever was
    # collected without a trailing blank line is still a record. An agent that ends its
    # stream on the last byte of the last event — no final "\n\n" — would otherwise have
    # its answer dropped silently, which is the same bug `lib/sse.py::close` exists for.
    if buffer:
        line = buffer.rstrip("\r")
        if not line.startswith(":"):
            name, _, value = line.partition(":")
            if name == "data":
                data.append(value[1:] if value.startswith(" ") else value)
    if data:
        with contextlib.suppress(ValueError):
            parsed = json.loads("\n".join(data))
            if isinstance(parsed, dict):
                yield parsed


class Bridge:
    def __init__(self, config: Config) -> None:
        self.config = config
        self._limit = asyncio.Semaphore(MAX_CONCURRENT_RUNS)
        self._runs: set[asyncio.Task[None]] = set()

    async def serve_forever(self) -> None:
        """Connect, and keep connecting.

        A laptop closes its lid, a wifi network changes, a deploy restarts the server.
        None of those should need a person, so every disconnect is a reconnect with
        backoff — full jitter, because a server coming back to fifty agents that all
        reconnect on the same schedule is a server that goes down again.
        """
        delay = RECONNECT_MIN_SEC
        while True:
            try:
                await self._session()
                delay = RECONNECT_MIN_SEC  # a clean run means the next retry starts small
            except websockets.InvalidStatus as error:
                status = error.response.status_code
                if status in (401, 403):
                    # A bad token does not get better by trying again, and hammering an
                    # endpoint with a dead credential is how a client gets blocked.
                    raise SystemExit(
                        "Blob refused the bot token. Check BLOB_BOT_TOKEN, and that the "
                        "app is still enabled."
                    ) from error
                log.warning("connection refused with %s", status)
            except (OSError, websockets.WebSocketException) as error:
                log.warning("connection lost: %s", error)
            except Exception:
                log.exception("unexpected failure in the connection loop")

            wait = random.uniform(0, delay)
            log.info("reconnecting in %.1fs", wait)
            await asyncio.sleep(wait)
            delay = min(delay * 2, RECONNECT_MAX_SEC)

    async def _session(self) -> None:
        """One connection, from handshake to disconnect."""
        # The token goes in a header rather than a query parameter on purpose: `?token=`
        # is the first thing every reverse proxy writes to an access log. Blob also
        # accepts a first frame of `{"t":"auth","token":...}` for clients that cannot set
        # headers, which is not this one.
        async with websockets.connect(
            self.config.socket_url,
            additional_headers={"Authorization": f"Bearer {self.config.token}"},
            max_size=MAX_FRAME_BYTES,
            open_timeout=30,
            ping_interval=None,  # the protocol has its own ping; two is noise
        ) as socket:
            log.info("connected to %s", self.config.socket_url)
            heartbeat = asyncio.create_task(self._heartbeat(socket))
            try:
                await self._read_loop(socket)
            finally:
                heartbeat.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await heartbeat
                await self._drain_runs()

    async def _heartbeat(self, socket: Any) -> None:
        while True:
            await asyncio.sleep(PING_INTERVAL_SEC)
            await socket.send(json.dumps({"t": "ping"}))

    async def _read_loop(self, socket: Any) -> None:
        async for raw in socket:
            try:
                frame = json.loads(raw)
            except ValueError:
                log.warning("ignoring a frame that is not JSON")
                continue
            if not isinstance(frame, dict):
                continue

            kind = frame.get("t")
            if kind == "ready":
                log.info(
                    "authenticated as %r (scopes: %s)",
                    frame.get("name"),
                    ", ".join(frame.get("scopes") or []) or "none",
                )
                await self._say_hello(socket)
            elif kind == "run":
                run_id, run_input = frame.get("runId"), frame.get("input")
                if isinstance(run_id, str) and isinstance(run_input, dict):
                    self._start_run(socket, run_id, run_input)
            elif kind == "pong":
                pass
            elif kind == "hello_ok":
                log.info("Blob accepted the description")
            elif kind == "error":
                log.warning("Blob said: %s", frame.get("message"))
            else:
                # Unknown frames are ignored rather than fatal, for the reason the server
                # gives about unknown AG-UI events: this protocol will gain frames, and a
                # strict reader turns next month's addition into a dead agent.
                continue

    async def _say_hello(self, socket: Any) -> None:
        """Describe ourselves, if there is anything to say.

        Connecting *is* registering: an agent says what it is on the way in rather than
        being described by hand in a console it has never heard of. What it may *do* is
        not up for self-declaration — scopes stay whatever an admin approved.
        """
        fields = {
            k: v
            for k, v in (
                ("name", self.config.name),
                ("description", self.config.description),
                ("version", self.config.version),
            )
            if v
        }
        if fields:
            await socket.send(json.dumps({"t": "hello", **fields}))

    def _start_run(self, socket: Any, run_id: str, run_input: dict[str, Any]) -> None:
        task = asyncio.create_task(self._run(socket, run_id, run_input))
        # Held in a set so a run is not garbage-collected mid-flight, and discarded on
        # completion. `_drain_runs` snapshots the set before cancelling — iterating a live
        # set whose members remove themselves from it silently skips half of them.
        self._runs.add(task)
        task.add_done_callback(self._runs.discard)

    async def _run(self, socket: Any, run_id: str, run_input: dict[str, Any]) -> None:
        """Forward one run to the local agent and relay what it says.

        `done` is sent in a `finally`, always. The server holds a run open until it is
        told otherwise, so a bridge that failed without saying so would cost the person a
        full timeout of silence — the one outcome worse than an error.
        """
        posted = 0
        try:
            async with self._limit:
                async for event in self._ask_agent(run_input):
                    posted += 1
                    await socket.send(json.dumps({"t": "event", "runId": run_id, "event": event}))
        except Exception as error:
            log.exception("run %s failed", run_id)
            if posted == 0:
                # Only when nothing was said. Appending an error under a real answer is
                # how a run that mostly worked reads as broken.
                with contextlib.suppress(Exception):
                    await socket.send(
                        json.dumps(
                            {
                                "t": "event",
                                "runId": run_id,
                                "event": {"type": "RUN_ERROR", "message": str(error)[:400]},
                            }
                        )
                    )
        finally:
            with contextlib.suppress(Exception):
                await socket.send(json.dumps({"t": "done", "runId": run_id}))

    async def _ask_agent(self, run_input: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        """POST the run to the local AG-UI server, signed the way Blob signs a delivery."""
        body = json.dumps(run_input).encode()
        timestamp = int(time.time())
        headers = {
            "content-type": "application/json",
            "accept": "text/event-stream",
        }
        if self.config.signing_secret:
            headers["x-blob-request-timestamp"] = str(timestamp)
            headers["x-blob-signature"] = _sign(self.config.signing_secret, timestamp, body)

        timeout = httpx.Timeout(AGENT_TIMEOUT_SEC, read=AGENT_TIMEOUT_SEC)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", self.config.agui_url, content=body, headers=headers
            ) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", "replace")[:300]
                    raise RuntimeError(f"the agent answered {response.status_code}: {detail}")
                async for event in _sse_events(response):
                    yield event

    async def _drain_runs(self) -> None:
        """Cancel what is still in flight, snapshotting first.

        The set is mutated by each task's done-callback, so cancelling while iterating it
        skips members and the gather that follows awaits only what survived. Blob's own
        `AgentConnection` had this bug and the symptom was tasks outliving the connection.
        """
        pending = list(self._runs)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
    )
    config = Config()
    log.info("bridging %s  ->  %s", config.socket_url, config.agui_url)
    try:
        asyncio.run(Bridge(config).serve_forever())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
