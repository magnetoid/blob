"""Background jobs.

Anything that must not slow down a message send — push delivery, link unfurls,
thumbnails, digests — is enqueued after the transaction commits and handled by the
worker process.

Enqueueing never raises into a request: a lost unfurl must not fail a message send.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Coroutine
from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from ..config import settings

log = logging.getLogger("blob.queue")

_pool: ArqRedis | None = None


def serialize_job(job: dict[str, Any]) -> bytes:
    """A job as it crosses Redis: JSON, never arq's default pickle.

    Unpickling runs whatever the bytes say, so with pickle anything able to write to Redis
    could run code in the worker — which holds the database's credentials — and in the
    production stack an agent's container shares that network (the 2026-10 security
    review). Every job here carries ids and nothing else; a result that is not JSON is kept
    as its text.
    """
    return json.dumps(job, separators=(",", ":"), default=str).encode()


def deserialize_job(raw: bytes) -> dict[str, Any]:
    """The other half: a job that is not a JSON object — a pickle among them — is refused
    unread, and arq drops it rather than running it."""
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("a job is a JSON object")
    return value


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.REDIS_URL)


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(
            redis_settings(), job_serializer=serialize_job, job_deserializer=deserialize_job
        )
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
    try:
        task = asyncio.create_task(coro)
    except RuntimeError:
        # A coroutine that never made it onto a loop must still be closed, or Python
        # warns about it later while the real failure has long since passed.
        coro.close()
        raise
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def close_queue() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
