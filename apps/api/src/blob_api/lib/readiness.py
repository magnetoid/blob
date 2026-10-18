"""What `/readyz` reports beyond "Postgres and Redis answered".

Three things used to be invisible from outside, and each has cost a production day:

* **The schema.** The entrypoint migrates before the server starts, but with
  `RUN_MIGRATIONS=false`, or a migration that failed and a process that started anyway,
  the app serves against a schema it was not written for, and every route touching a new
  column answers 500 while readiness said ok. This is the one check that fails the probe:
  a process on the wrong schema cannot serve.
* **The worker.** Notifications, reminders, scheduled sends, agent runs and the outbox
  all live in the arq worker. When it is down the app looks perfect and nothing that
  should happen later ever does. The worker writes a heartbeat once a minute; this reads
  its age. Reported, not failed: the app serves without it, and readiness failing would
  take chat down to report that reminders are late.
* **Object storage, as the browser sees it.** `storage.probe` — the check the admin
  health page already runs — cached for a minute, because this URL is public and must
  not become a way to make the server fetch something on every request. Reported, not
  failed, for the same reason as the worker.

Only status words go out. This is a public URL, so nothing here names an address,
a count or a person.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from functools import lru_cache

from . import storage
from .redis import WORKER_HEARTBEAT_KEY, redis

#: The worker writes its heartbeat every minute; three missed beats is "down".
WORKER_STALE_AFTER_SEC = 180
STORAGE_CACHE_SEC = 60.0

_storage_cache: tuple[float, str] | None = None


@lru_cache(maxsize=1)
def _heads() -> frozenset[str]:
    """The revision(s) this build's migrations end at. Read once: they cannot change
    while the process runs."""
    from alembic.script import ScriptDirectory

    from ..db.migrate import alembic_config

    return frozenset(ScriptDirectory.from_config(alembic_config()).get_heads())


async def schema_state(applied: set[str]) -> str:
    """`current` when the database is at this build's head, else `behind`."""
    heads = await asyncio.to_thread(_heads)
    return "current" if applied == set(heads) else "behind"


async def worker_state() -> str:
    """`ok` when the worker has beaten in the last three minutes, `stale` when it last
    beat longer ago, `missing` when it never has (or Redis lost the key)."""
    try:
        beat = await redis.get(WORKER_HEARTBEAT_KEY)
    except Exception:
        return "unknown"
    if not beat:
        return "missing"
    try:
        age = (datetime.now(UTC) - datetime.fromisoformat(beat)).total_seconds()
    except ValueError:
        return "unknown"
    return "ok" if age <= WORKER_STALE_AFTER_SEC else "stale"


async def storage_state() -> str:
    global _storage_cache
    now = time.monotonic()
    if _storage_cache is not None and now - _storage_cache[0] < STORAGE_CACHE_SEC:
        return _storage_cache[1]
    try:
        state = await storage.probe()
    except Exception:
        state = "unreachable"
    _storage_cache = (now, state)
    return state


def reset_for_tests() -> None:
    global _storage_cache
    _storage_cache = None


async def beat() -> None:
    """The worker's side: called from a cron every minute."""
    await redis.set(
        WORKER_HEARTBEAT_KEY, datetime.now(UTC).isoformat(), ex=WORKER_STALE_AFTER_SEC * 2
    )


__all__ = [
    "beat",
    "reset_for_tests",
    "schema_state",
    "storage_state",
    "worker_state",
]
