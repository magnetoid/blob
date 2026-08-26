"""Agents that dial in.

Every other runtime is reached by Blob making a request to an address. That assumption
is load-bearing in `plugins/agui.py` and stated there deliberately: **Blob is the AG-UI
client and the agent is the server**, because every agent framework ships a server and
none ships a client that pushes into somebody else's inbox.

This module is the exception, and it is an exception about *transport*, not about
direction. A socket agent still answers runs it did not initiate; Blob still drives. What
changes is who opens the TCP connection, because an agent on somebody's laptop has no
address to be called at — no public hostname, no certificate, no route through their NAT.
Asking for one means asking them to run a tunnel forever. So the agent dials Blob, holds
the connection, and runs are written down it. Slack shipped Socket Mode for exactly this
and for exactly this reason. See ADR 0012.

**The hard part is that the process holding the socket is not the process running the
job.** Mentions are handled by the arq worker; sockets are held by an API process. So a
run crosses processes, and it crosses them the way everything else here does — through
Redis, with the same reasoning as `realtime/hub.py`: a second container needs no code
change.

Three keys carry it:

* `agent:conn:{plugin_id}` — a TTL key the holder refreshes. Liveness lives in Redis and
  not in a column, because a row saying "connected" outlives the process that wrote it
  and then lies. A key that stops being refreshed stops existing, which is the truth.
* `agent:run:{plugin_id}` — where a run request is published. The holder is subscribed.
* `agent:evt:{run_id}` — where the agent's AG-UI events come back, one per message.

Pub/sub is fan-out, so a run published once can arrive at two holders — the agent
reconnected to a second process while the first still believed it had the socket. Both
would answer, and the person would see the reply twice. The holder therefore claims the
run id with `SET NX` before writing anything, the same claim `jobs/agui.py` takes on a
message before answering it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import weakref
from collections.abc import AsyncIterator
from typing import Any

from ..config import settings
from ..lib.ids import new_id
from ..lib.redis import redis, redis_sub

log = logging.getLogger("blob.agents.gateway")

#: How long a connection key survives without a refresh, and how often the holder
#: refreshes it. The gap is deliberate: a refresh has to be able to miss twice before the
#: agent is declared gone, or an event-loop hiccup reads as a disconnect.
CONN_TTL_SEC = 45
CONN_REFRESH_SEC = 15

#: How long a claimed run id stays claimed. Long enough that a slow run cannot be picked
#: up a second time, short enough that the keys drain on their own.
CLAIM_TTL_SEC = 300

#: What the agent may send in one frame. A socket has no Content-Length to check up
#: front, so the ceiling is per frame and the running total is the caller's business.
MAX_FRAME_BYTES = 512 * 1024


def conn_key(plugin_id: str) -> str:
    return f"agent:conn:{plugin_id}"


def run_channel(plugin_id: str) -> str:
    return f"agent:run:{plugin_id}"


def event_channel(run_id: str) -> str:
    return f"agent:evt:{run_id}"


def claim_key(run_id: str) -> str:
    return f"agent:claim:{run_id}"


# ─── the caller's side: the worker, which has no socket ───────────────────────


async def is_online(plugin_id: str) -> bool:
    """Whether any process currently holds this agent's connection."""
    return bool(await redis.exists(conn_key(plugin_id)))


async def stream_events(
    plugin_id: str, run_input: dict[str, Any], *, timeout_sec: float
) -> AsyncIterator[dict[str, Any]]:
    """Ask the agent to run, and yield the AG-UI events it sends back.

    Subscribing happens *before* publishing, and that order is the whole reason this is
    not three lines. The agent can answer in single-digit milliseconds; publish first and
    the first events are broadcast to a channel nobody is listening on yet, so the run
    appears to hang and then time out having actually succeeded.

    Yields raw AG-UI event mappings — the same shape `SseDecoder` produces on the HTTP
    path, so `Fold` cannot tell the two transports apart and there is one implementation
    of what an event *means*.
    """
    run_id = new_id()
    pubsub = redis_sub.pubsub()
    try:
        await pubsub.subscribe(event_channel(run_id))
        await redis.publish(
            run_channel(plugin_id),
            json.dumps({"runId": run_id, "input": run_input}),
        )

        deadline = asyncio.get_running_loop().time() + timeout_sec
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True, timeout=remaining),
                    timeout=remaining,
                )
            except TimeoutError:
                return
            if message is None:
                continue
            try:
                frame = json.loads(message["data"])
            except (ValueError, TypeError):
                continue
            if frame.get("t") == "end":
                return
            event = frame.get("event")
            if isinstance(event, dict):
                yield event
    finally:
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]


# ─── the holder's side: the API process the agent connected to ────────────────

#: Connections this process is holding. Weak, so a connection that is dropped without its
#: context manager unwinding — a crashed handler — does not keep itself alive here.
#:
#: Reported by the admin health endpoint the way `hub` reports its socket counts, and used
#: by the tests as a barrier: an agent connection owns background tasks, and a test that
#: returns before they stop leaves them running into the next one on a shared event loop.
_live: weakref.WeakSet[AgentConnection] = weakref.WeakSet()


def live_connections() -> int:
    """How many agent sockets this process is currently holding."""
    return len(_live)


class AgentConnection:
    """One live agent socket, and the pump that feeds it runs from other processes.

    Owns nothing durable. When this object goes away the agent is offline, the TTL key
    lapses, and a run published for it finds no listener — which `stream_events` reports
    as the agent not answering, because from the far side of Redis those are the same
    thing.
    """

    # `__weakref__` is listed because `__slots__` otherwise omits it, and `_live` is a
    # WeakSet — without it, registering a connection raises rather than tracking it.
    __slots__ = ("__weakref__", "_send", "_tasks", "plugin_id")

    def __init__(self, plugin_id: str, send: Any) -> None:
        self.plugin_id = plugin_id
        self._send = send
        self._tasks: set[asyncio.Task[None]] = set()

    async def __aenter__(self) -> AgentConnection:
        await redis.set(conn_key(self.plugin_id), "1", ex=CONN_TTL_SEC)
        _live.add(self)
        self._spawn(self._refresh_presence())
        self._spawn(self._pump_runs())
        return self

    async def __aexit__(self, *_exc: object) -> None:
        # Snapshotted before cancelling, and this is the whole of the bug it fixes: the
        # done-callback discards each task from `_tasks` as it finishes, so iterating the
        # live set while cancelling mutates it mid-loop, and the `gather` that followed
        # awaited whatever happened to be left. Tasks outlived the connection, kept
        # refreshing a key for an agent that had gone, and — in tests, where one event
        # loop is shared — ran on into the next one.
        pending = tuple(self._tasks)
        for task in pending:
            task.cancel()
        # Gathered so cancellation actually completes before the key is dropped;
        # otherwise a refresh already in flight can rewrite the key we just deleted and
        # leave the agent looking online for a full TTL after it left.
        await asyncio.gather(*pending, return_exceptions=True)
        self._tasks.clear()
        _live.discard(self)
        with contextlib.suppress(Exception):
            await redis.delete(conn_key(self.plugin_id))

    def _spawn(self, coro: Any) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _refresh_presence(self) -> None:
        while True:
            await asyncio.sleep(CONN_REFRESH_SEC)
            with contextlib.suppress(Exception):
                await redis.set(conn_key(self.plugin_id), "1", ex=CONN_TTL_SEC)

    async def _pump_runs(self) -> None:
        """Take run requests off Redis and write them to the agent.

        Supervised and resubscribing, for the reason `hub.start_redis_bridge` records: one
        `listen()` raising on a Redis blip must not silently end delivery for the life of
        the connection.
        """
        delay = 1.0
        while True:
            pubsub = redis_sub.pubsub()
            try:
                await pubsub.subscribe(run_channel(self.plugin_id))
                delay = 1.0
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        request = json.loads(message["data"])
                    except (ValueError, TypeError):
                        continue
                    run_id = request.get("runId")
                    run_input = request.get("input")
                    if not isinstance(run_id, str) or not isinstance(run_input, dict):
                        continue
                    # Fan-out means a second holder may see this too. Exactly one runs it.
                    #
                    # The value is the claiming plugin's id rather than a placeholder, and
                    # that is what makes the return path checkable: `relay_event` reads it
                    # back to confirm the agent sending events is the one that was asked.
                    if not await redis.set(
                        claim_key(run_id), self.plugin_id, nx=True, ex=CLAIM_TTL_SEC
                    ):
                        continue
                    await self._send({"t": "run", "runId": run_id, "input": run_input})
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning(
                    "agent %s run pump dropped, resubscribing in %.0fs: %s",
                    self.plugin_id,
                    delay,
                    error,
                )
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()  # type: ignore[no-untyped-call]
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)


async def owns_run(plugin_id: str, run_id: str) -> bool:
    """Whether this agent is the one that was asked to do this run.

    The check the return path was missing. Runs are addressed by id on a shared Redis
    channel, and nothing tied a `{"t":"event"}` frame to the agent that received the run —
    so any authenticated bot, in any workspace, could publish into another agent's run:
    fabricated `TEXT_MESSAGE_*` posted as *that* agent's reply, or a `RUN_ERROR` to kill
    it. A UUIDv7 run id is unguessable, which made it improbable rather than prevented,
    and "improbable" is not the property to rest a cross-tenant boundary on.

    The claim is the natural place to look: it is already written, already scoped to one
    run, and already expires. Reading it costs one Redis GET per event frame.
    """
    claimed = await redis.get(claim_key(run_id))
    if claimed is None:
        # Expired, or a run this process never saw claimed. Refused rather than allowed:
        # a run whose claim has lapsed is past its deadline and nobody is listening.
        return False
    if isinstance(claimed, bytes):
        claimed = claimed.decode()
    return str(claimed) == plugin_id


async def relay_event(run_id: str, event: dict[str, Any]) -> None:
    """Put one AG-UI event from the agent back on the wire to whoever asked for the run."""
    await redis.publish(event_channel(run_id), json.dumps({"event": event}))


async def relay_end(run_id: str) -> None:
    """Tell the caller the agent considers this run over, so it stops waiting on a clock."""
    await redis.publish(event_channel(run_id), json.dumps({"t": "end"}))


def run_timeout_sec() -> float:
    """The ceiling on a socket run.

    The HTTP path gets two timeouts from httpx — one to connect, one between reads. A
    held socket has already connected, so only the second idea survives, and it applies
    to the run as a whole.
    """
    return float(settings.AGUI_TIMEOUT_SEC + settings.AGUI_READ_TIMEOUT_SEC)


__all__ = [
    "MAX_FRAME_BYTES",
    "AgentConnection",
    "conn_key",
    "event_channel",
    "is_online",
    "live_connections",
    "relay_end",
    "relay_event",
    "run_channel",
    "run_timeout_sec",
    "stream_events",
]
