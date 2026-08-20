"""Background jobs.

Anything that must not slow down a message send — push delivery, link unfurls,
thumbnails, digests — is enqueued after the transaction commits and handled by the
worker process.

Enqueueing never raises into a request: a lost unfurl must not fail a message send.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from ..config import settings

log = logging.getLogger("blob.queue")

_pool: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.REDIS_URL)


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings())
    return _pool


async def enqueue(job: str, *args: Any) -> None:
    try:
        pool = await get_pool()
        await pool.enqueue_job(job, *args)
    except Exception:
        log.warning("could not enqueue %s", job, exc_info=True)


#: Tasks started without being awaited. Held so the garbage collector cannot reclaim a
#: running task mid-flight, which is a genuinely confusing way to lose a job.
_pending: set[asyncio.Task[None]] = set()


def fire_and_forget(coro: Coroutine[Any, Any, None]) -> None:
    """Start work the response should not wait for — enqueueing, mainly.

    Callers are in after-commit callbacks, which are synchronous by design, so this is
    how they reach an async function at all.
    """
    task = asyncio.create_task(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def close_queue() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
