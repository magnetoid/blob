"""Fixed-window rate limiting in Redis. Simple, adequate, and cheap at this scale."""

from __future__ import annotations

from typing import NamedTuple

from .errors import too_many_requests
from .redis import rate_key, redis


class Limit(NamedTuple):
    #: Requests allowed per window.
    max: int
    #: Window length in seconds.
    window_sec: int


LIMITS: dict[str, Limit] = {
    "login": Limit(10, 900),
    "signup": Limit(5, 3600),
    "password_reset": Limit(5, 3600),
    "send_message": Limit(30, 60),
    "upload": Limit(20, 60),
    "search": Limit(30, 60),
    "webhook": Limit(60, 60),
    "invite": Limit(30, 3600),
}


async def consume(name: str, subject: str) -> None:
    """Raise 429 when the subject has exhausted the window."""
    limit = LIMITS[name]
    key = rate_key(name, subject)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, limit.window_sec)
    if count > limit.max:
        ttl = await redis.ttl(key)
        when = f"in {ttl}s" if ttl > 0 else "in a moment"
        raise too_many_requests(f"Too many attempts. Try again {when}.")
