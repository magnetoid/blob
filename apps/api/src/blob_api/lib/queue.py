"""Background jobs.

Anything that must not slow down a message send — push delivery, link unfurls,
thumbnails, digests — is enqueued after the transaction commits and handled by the
worker process.

Enqueueing never raises into a request: a lost unfurl must not fail a message send.
"""

from __future__ import annotations

import logging
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


async def close_queue() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
