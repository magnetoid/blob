"""Redis holds everything ephemeral: presence, typing, rate limits, and the pub/sub
bridge that lets a second app process work with no code change.

Nothing here is durable. If Redis restarts, presence goes quiet for one heartbeat and
nothing else notices.
"""

from __future__ import annotations

from redis.asyncio import Redis

from ..config import settings

# Commands.
redis: Redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
# A subscriber connection cannot issue normal commands, so it needs its own socket.
redis_sub: Redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)

#: Channel on which app processes exchange WebSocket events.
EVENTS_CHANNEL = "ws:events"


def presence_key(user_id: str) -> str:
    return f"presence:{user_id}"


def presence_conns_key(user_id: str) -> str:
    """The set of live connection ids a user holds, across every app process."""
    return f"presence:conns:{user_id}"


def focus_key(user_id: str) -> str:
    """Hash of connection id -> the channel that connection is looking at."""
    return f"focus:{user_id}"


def typing_key(channel_id: str, user_id: str) -> str:
    return f"typing:{channel_id}:{user_id}"


def rate_key(bucket: str, subject: str) -> str:
    return f"rate:{bucket}:{subject}"


async def close_redis() -> None:
    await redis.aclose()
    await redis_sub.aclose()
