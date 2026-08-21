"""Event fan-out.

Connections register interest by user and by channel. Every emit goes to local sockets
and is published to Redis, where sibling processes re-broadcast to theirs — so running a
second container needs no code change.

Nothing here writes to Postgres. Emits happen after the transaction that produced them
has committed; see db/engine.transaction().

This module imports nothing from routers/, so the socket tier can move to its own
process unchanged when connection counts justify it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import secrets
from dataclasses import dataclass, field
from typing import Any

from ..lib.redis import EVENTS_CHANNEL, redis, redis_sub

log = logging.getLogger("blob.realtime.hub")

ServerEvent = dict[str, Any]

PROCESS_ID = f"{os.getpid()}-{secrets.token_hex(3)}"

#: A connection this far behind is a lost cause; drop it rather than buffer forever.
OUTBOX_LIMIT = 256


@dataclass(eq=False)
class Connection:
    id: str
    user_id: str
    outbox: asyncio.Queue[ServerEvent]
    #: Channels this connection currently receives events for.
    channel_ids: set[str] = field(default_factory=set)
    #: Users whose presence this connection asked for (Slack's presence_sub). Maintained
    #: through set_presence_subs, which keeps the reverse index in step; assigning to it
    #: directly would leave that index stale.
    presence_subs: set[str] = field(default_factory=set)
    #: The channel the user is looking at right now, if any.
    focused_channel_id: str | None = None
    closed: bool = False
    #: Set when this connection is dropped, so whoever owns the socket can tear it down.
    #: `closed` alone is a flag nobody is waiting on: the socket's read loop sits in
    #: `receive_json` until the client stops talking, and a client that is merely slow
    #: keeps talking. Without something to wait on, a dropped connection stayed
    #: registered and silent — online to the user, and receiving nothing.
    closed_event: asyncio.Event = field(default_factory=asyncio.Event)

    def send(self, event: ServerEvent) -> None:
        """Queue an event.

        Synchronous on purpose: services emit from ordinary code, and awaiting a socket
        write there would put an unrelated client's backpressure on the send path.
        """
        if self.closed:
            return
        try:
            self.outbox.put_nowait(event)
        except asyncio.QueueFull:
            # Slow consumer. Dropping the connection is kinder than unbounded memory;
            # the client reconnects and resyncs over REST — which only happens if the
            # socket actually closes, hence the event.
            self.close()

    def close(self) -> None:
        self.closed = True
        self.closed_event.set()


_by_connection: dict[str, Connection] = {}
_by_user: dict[str, set[Connection]] = {}
_by_channel: dict[str, set[Connection]] = {}
#: Subject user id -> the connections watching that user's presence. The reverse of
#: Connection.presence_subs, kept so a presence flip costs a dict lookup instead of a
#: scan of every socket in the process. The client subscribes to everyone it can see, so
#: without this a workspace-wide reconnect is quadratic.
_by_presence_sub: dict[str, set[Connection]] = {}
#: Strong references, so fire-and-forget publishes are not garbage collected mid-flight.
_tasks: set[asyncio.Task[Any]] = set()


def new_connection(connection_id: str, user_id: str) -> Connection:
    return Connection(id=connection_id, user_id=user_id, outbox=asyncio.Queue(OUTBOX_LIMIT))


def register(conn: Connection) -> None:
    _by_connection[conn.id] = conn
    _add(_by_user, conn.user_id, conn)


def unregister(conn: Connection) -> None:
    _by_connection.pop(conn.id, None)
    _remove(_by_user, conn.user_id, conn)
    for channel_id in conn.channel_ids:
        _remove(_by_channel, channel_id, conn)
    for subject_id in conn.presence_subs:
        _remove(_by_presence_sub, subject_id, conn)
    conn.channel_ids.clear()
    conn.presence_subs.clear()


def set_presence_subs(conn: Connection, user_ids: list[str]) -> None:
    """Replace what this connection watches, and keep the reverse index in step."""
    wanted = set(user_ids)
    for subject_id in conn.presence_subs - wanted:
        _remove(_by_presence_sub, subject_id, conn)
    for subject_id in wanted - conn.presence_subs:
        _add(_by_presence_sub, subject_id, conn)
    conn.presence_subs = wanted


def subscribe_channels(conn: Connection, channel_ids: list[str]) -> None:
    for channel_id in channel_ids:
        if channel_id in conn.channel_ids:
            continue
        conn.channel_ids.add(channel_id)
        _add(_by_channel, channel_id, conn)


def unsubscribe_channel(conn: Connection, channel_id: str) -> None:
    if channel_id not in conn.channel_ids:
        return
    conn.channel_ids.discard(channel_id)
    _remove(_by_channel, channel_id, conn)


def to_channel(channel_id: str, event: ServerEvent) -> None:
    """Everyone currently subscribed to a channel."""
    _deliver_local(event, {"channelId": channel_id})
    _publish({"origin": PROCESS_ID, "event": event, "to": {"channelId": channel_id}})


def to_users(user_ids: list[str], event: ServerEvent) -> None:
    """Every connection belonging to these users (all their devices)."""
    if not user_ids:
        return
    _deliver_local(event, {"userIds": user_ids})
    _publish({"origin": PROCESS_ID, "event": event, "to": {"userIds": user_ids}})


def to_all(event: ServerEvent) -> None:
    """Everyone connected — used for workspace-wide facts like a profile change."""
    _deliver_local(event, {"all": True})
    _publish({"origin": PROCESS_ID, "event": event, "to": {"all": True}})


def to_presence_subscribers(user_id: str, event: ServerEvent) -> None:
    """Presence updates go only to connections that asked about this user."""
    _deliver_presence(user_id, event)
    _publish({"origin": PROCESS_ID, "event": event, "to": {"presence": user_id}})


def _deliver_presence(user_id: str, event: ServerEvent) -> None:
    for conn in list(_by_presence_sub.get(user_id, set())):
        conn.send(event)


def is_user_online(user_id: str) -> bool:
    return bool(_by_user.get(user_id))


def focused_channels(user_id: str) -> set[str]:
    """Which channel each of a user's connections is currently focused on."""
    return {
        conn.focused_channel_id for conn in _by_user.get(user_id, set()) if conn.focused_channel_id
    }


def connections_for_user(user_id: str) -> list[Connection]:
    return list(_by_user.get(user_id, set()))


def stats() -> dict[str, int]:
    return {
        "connections": len(_by_connection),
        "users": len(_by_user),
        "channels": len(_by_channel),
    }


def _deliver_local(event: ServerEvent, to: dict[str, Any]) -> None:
    if to.get("all"):
        for conn in list(_by_connection.values()):
            conn.send(event)
        return
    if "channelId" in to:
        for conn in list(_by_channel.get(to["channelId"], set())):
            conn.send(event)
        return
    if "userIds" in to:
        seen: set[str] = set()
        for user_id in to["userIds"]:
            for conn in list(_by_user.get(user_id, set())):
                if conn.id in seen:
                    continue
                seen.add(conn.id)
                conn.send(event)


def _publish(envelope: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # No loop (e.g. a unit test); local delivery already happened.

    task = loop.create_task(_publish_async(envelope))
    _tasks.add(task)
    task.add_done_callback(_forget)


async def _publish_async(envelope: dict[str, Any]) -> None:
    await redis.publish(EVENTS_CHANNEL, json.dumps(envelope))


def _forget(task: asyncio.Task[Any]) -> None:
    """Drop the reference and surface any error the publish raised."""
    _tasks.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        # Retrieved to keep asyncio quiet, and logged because a publish that failed is a
        # sibling process that never heard the event. Silently discarding it meant
        # cross-process delivery could degrade with nothing to find afterwards.
        log.warning("cross-process publish failed: %s", error)


_bridge_started = False


#: How long to wait before resubscribing after the bridge drops, and the ceiling it
#: backs off to. A Redis restart is over in seconds; a longer outage should not become a
#: reconnect storm from every process at once.
BRIDGE_RETRY_SEC = 1.0
BRIDGE_RETRY_MAX_SEC = 30.0


async def start_redis_bridge() -> None:
    """Re-broadcast events published by sibling processes to our local connections.

    Supervised, because the first version was not. One `listen()` raising — a Redis
    restart, a failover, a network blip — ended the task for good: the exception was
    never retrieved, nothing was logged, and `_bridge_started` stayed true so it could
    not be started again. Cross-process delivery stopped until someone restarted the
    container, and nothing anywhere said so.
    """
    global _bridge_started
    if _bridge_started:
        return
    _bridge_started = True

    async def loop() -> None:
        delay = BRIDGE_RETRY_SEC
        while True:
            pubsub = redis_sub.pubsub()
            try:
                await pubsub.subscribe(EVENTS_CHANNEL)
                delay = BRIDGE_RETRY_SEC  # Connected; forget any previous backoff.
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        envelope = json.loads(message["data"])
                    except (ValueError, TypeError):
                        continue
                    if envelope.get("origin") == PROCESS_ID:
                        continue

                    to = envelope.get("to", {})
                    event = envelope.get("event", {})
                    # Presence subscription sets are per-connection state and cannot be
                    # addressed across processes; each process consults its own.
                    if "presence" in to:
                        _deliver_presence(to["presence"], event)
                        continue
                    _deliver_local(event, to)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.warning("redis bridge dropped, resubscribing in %.0fs: %s", delay, error)
            finally:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()  # type: ignore[no-untyped-call]

            await asyncio.sleep(delay)
            delay = min(delay * 2, BRIDGE_RETRY_MAX_SEC)

    task = asyncio.create_task(loop())
    _tasks.add(task)


async def stop_redis_bridge() -> None:
    global _bridge_started
    _bridge_started = False
    for task in list(_tasks):
        task.cancel()
    _tasks.clear()


def reset_for_tests() -> None:
    _by_connection.clear()
    _by_user.clear()
    _by_channel.clear()
    _by_presence_sub.clear()


def _add(mapping: dict[str, set[Connection]], key: str, value: Connection) -> None:
    mapping.setdefault(key, set()).add(value)


def _remove(mapping: dict[str, set[Connection]], key: str, value: Connection) -> None:
    bucket = mapping.get(key)
    if bucket is None:
        return
    bucket.discard(value)
    if not bucket:
        mapping.pop(key, None)
