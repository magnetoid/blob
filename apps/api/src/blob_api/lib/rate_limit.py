"""Sliding-window rate limiting in Redis using sorted sets.

The limiter fails open: when Redis is unreachable the request proceeds unlimited
rather than erroring. A guard must never become the outage — a Redis blip that
500s every message send, login and search would take the workspace down to protect
it from load it is not receiving.
"""

from __future__ import annotations

import logging
import time
from typing import NamedTuple

from .errors import too_many_requests
from .redis import rate_key, redis

log = logging.getLogger(__name__)


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
    # Pressing a button is cheaper and more frequent than writing a message, but it
    # still reaches an app over the network, so it is not free.
    "interaction": Limit(60, 60),
    # Reading a conversation in another language is a handful of calls, not a stream of
    # them — and each one can bill a third party, so this is the workspace's wallet as
    # much as its capacity. Cached translations never reach here.
    "translate": Limit(20, 60),
    # A command can post a message, so it cannot be cheaper than sending one. The window
    # matches `send_message` for that reason rather than by coincidence.
    "command": Limit(30, 60),
    # Every catch-up can fan out several model calls, each billing a third party.
    # Safe to gate hard because the limiter fails open — a Redis blip cannot turn
    # this guard into the outage.
    "catchup": Limit(10, 300),
    # Registering an agent mints credentials and a bot user. Nobody needs more than a
    # handful an hour, and a loop that does would fill the workspace with bots.
    "agent_attach": Limit(5, 3600),
}


async def consume(name: str, subject: str) -> None:
    """Raise 429 when the subject has exhausted the window."""
    limit = LIMITS[name]
    key = rate_key(name, subject)
    now = time.time()
    now_ns = time.time_ns()
    window_start = now - limit.window_sec

    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, window_start)
            pipe.zcard(key)
            pipe.zadd(key, {str(now_ns): now})
            pipe.expire(key, limit.window_sec)
            results = await pipe.execute()
        count = results[1]
    except Exception:
        # Fail open, the same posture as `queue.enqueue`: the limiter is a guard on
        # the write path, not part of it, and its failure must stay its own.
        log.warning("rate limiter unavailable; letting %s through", name, exc_info=True)
        return

    if count >= limit.max:
        raise too_many_requests("Too many attempts. Try again in a moment.")
