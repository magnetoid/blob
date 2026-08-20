"""Sliding-window rate limiting in Redis using sorted sets."""

from __future__ import annotations

import time
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
    now = time.time()
    now_ns = time.time_ns()
    window_start = now - limit.window_sec

    async with redis.pipeline(transaction=True) as pipe:
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zcard(key)
        pipe.zadd(key, {str(now_ns): now})
        pipe.expire(key, limit.window_sec)
        results = await pipe.execute()
        
    count = results[1]
    if count >= limit.max:
        raise too_many_requests("Too many attempts. Try again in a moment.")
