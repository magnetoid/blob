"""Presence and typing.

Both live only in Redis with a TTL — losing them costs one heartbeat of accuracy and
nothing else. Presence updates are pushed only to connections that explicitly subscribed
to that user, which is the change that cut Slack's presence traffic fivefold.
"""

from __future__ import annotations

from typing import Literal

from ..lib.redis import presence_key, redis, typing_key
from . import hub

PresenceState = Literal["active", "away", "offline"]

#: Presence keys expire after two missed heartbeats.
PRESENCE_TTL_SEC = 60
#: Typing indicator lifetime, matched by the client's own timeout.
TYPING_TTL_MS = 5_000


async def mark_active(user_id: str) -> None:
    previous = await redis.get(presence_key(user_id))
    await redis.set(presence_key(user_id), "active", ex=PRESENCE_TTL_SEC)
    if previous != "active":
        _announce(user_id, "active")


async def mark_away(user_id: str) -> None:
    previous = await redis.get(presence_key(user_id))
    await redis.set(presence_key(user_id), "away", ex=PRESENCE_TTL_SEC)
    if previous != "away":
        _announce(user_id, "away")


async def mark_offline(user_id: str) -> None:
    """Called when a user's last connection drops."""
    if hub.is_user_online(user_id):
        return
    await redis.delete(presence_key(user_id))
    _announce(user_id, "offline")


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
