"""Presence and typing.

Both live only in Redis with a TTL — losing them costs one heartbeat of accuracy and
nothing else. Presence updates are pushed only to connections that explicitly subscribed
to that user, which is the change that cut Slack's presence traffic fivefold.
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Literal, cast

from ..lib.redis import focus_key, presence_conns_key, presence_key, redis, typing_key
from . import hub
from .protocol import TYPING_TTL_MS

PresenceState = Literal["active", "away", "offline"]

#: Presence keys expire after two missed heartbeats.
PRESENCE_TTL_SEC = 60

#: The connection and focus registries outlive a heartbeat gap but not a dead process:
#: refreshed on every ping, they expire on their own when a process crashes without
#: unregistering — the cost of that crash is a user reading as online for this long.
CONNS_TTL_SEC = 90


async def mark_active(user_id: str) -> None:
    previous = await redis.get(presence_key(user_id))
    await redis.set(presence_key(user_id), "active", ex=PRESENCE_TTL_SEC)
    if previous != "active":
        _announce(user_id, "active")


async def mark_present(user_id: str) -> None:
    """A heartbeat: still here. Not a claim about *how*.

    `mark_active` is a statement — "this person is active now" — and the socket was
    making it on every connect and every ping. HEARTBEAT_MS is 25 seconds, so `/away`
    lasted twenty-five seconds and then silently flipped the dot back to green while the
    person was still away; running `/away` again just said "You're now away." a second
    time, because the toggle re-read presence and found "active". Nothing anywhere
    re-asserted it.

    So a heartbeat keeps somebody where they already are and only *decides* when they
    have not decided for themselves. `/away` stays until they say otherwise, or until
    the socket goes and takes the key with it.
    """
    previous = await redis.get(presence_key(user_id))
    if previous == "away":
        # Kept alive, not overwritten: the TTL is two missed heartbeats, so leaving it
        # to expire would lose the away state rather than preserve it.
        await redis.expire(presence_key(user_id), PRESENCE_TTL_SEC)
        return
    await redis.set(presence_key(user_id), "active", ex=PRESENCE_TTL_SEC)
    if previous != "active":
        _announce(user_id, "active")


async def mark_away(user_id: str) -> None:
    previous = await redis.get(presence_key(user_id))
    await redis.set(presence_key(user_id), "away", ex=PRESENCE_TTL_SEC)
    if previous != "away":
        _announce(user_id, "away")


async def mark_offline(user_id: str) -> None:
    """Called when a user's last local connection drops.

    The liveness check reads the cross-process registry, not this process's tables: a
    person with a socket on a sibling container is still online, and announcing them
    offline because *this* process lost its copy was the multi-process bug.
    """
    # cast: redis-py types the sync and async clients with one signature.
    if await cast("Awaitable[int]", redis.scard(presence_conns_key(user_id))) > 0:
        return
    await redis.delete(presence_key(user_id))
    _announce(user_id, "offline")


# ─── the cross-process connection registry ────────────────────────────────────


async def track_connection(user_id: str, conn_id: str) -> None:
    async with redis.pipeline(transaction=False) as pipe:
        pipe.sadd(presence_conns_key(user_id), conn_id)
        pipe.expire(presence_conns_key(user_id), CONNS_TTL_SEC)
        await pipe.execute()


async def refresh_connection(user_id: str, conn_id: str) -> None:
    """Keep the registries alive; called on every heartbeat.

    Re-adds rather than merely re-expiring, so a connection that outlived a Redis
    restart re-registers itself instead of staying invisible until it reconnects.
    """
    async with redis.pipeline(transaction=False) as pipe:
        pipe.sadd(presence_conns_key(user_id), conn_id)
        pipe.expire(presence_conns_key(user_id), CONNS_TTL_SEC)
        pipe.expire(focus_key(user_id), CONNS_TTL_SEC)
        await pipe.execute()


async def untrack_connection(user_id: str, conn_id: str) -> None:
    async with redis.pipeline(transaction=False) as pipe:
        pipe.srem(presence_conns_key(user_id), conn_id)
        pipe.hdel(focus_key(user_id), conn_id)
        await pipe.execute()


async def set_focus(user_id: str, conn_id: str, channel_id: str | None) -> None:
    """Record which channel one connection is looking at, visible to every process.

    The worker consults this to skip pushing at someone already reading the channel —
    and the worker holds no sockets, which is why this cannot live in the hub.
    """
    async with redis.pipeline(transaction=False) as pipe:
        if channel_id is None:
            pipe.hdel(focus_key(user_id), conn_id)
        else:
            pipe.hset(focus_key(user_id), conn_id, channel_id)
            pipe.expire(focus_key(user_id), CONNS_TTL_SEC)
        await pipe.execute()


async def focused_channels(user_id: str) -> set[str]:
    """Every channel this user has on screen right now, on any device, any process."""
    return set(await cast("Awaitable[list[str]]", redis.hvals(focus_key(user_id))))


async def get_presence(user_ids: list[str]) -> dict[str, PresenceState]:
    if not user_ids:
        return {}
    values = await redis.mget([presence_key(user_id) for user_id in user_ids])
    result: dict[str, PresenceState] = {}
    for user_id, value in zip(user_ids, values, strict=True):
        result[user_id] = value if value in ("active", "away") else "offline"
    return result


async def set_typing(channel_id: str, user_id: str, thread_root_id: str | None) -> None:
    await redis.set(typing_key(channel_id, user_id), thread_root_id or "", px=TYPING_TTL_MS)
    hub.to_channel(
        channel_id,
        {
            "t": "typing",
            "channelId": channel_id,
            "userId": user_id,
            "threadRootId": thread_root_id,
        },
    )


def _announce(user_id: str, state: PresenceState) -> None:
    hub.to_presence_subscribers(user_id, {"t": "presence", "userId": user_id, "state": state})
