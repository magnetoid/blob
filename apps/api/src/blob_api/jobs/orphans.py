"""What the nightly orphan sweep last did, kept for the Storage page.

`worker.sweep_orphans` deletes uploads that never reached a message. It used to record
its outcome nowhere but the worker's log, so an admin asking whether the sweep runs at
all had nothing to read. The outcome now goes to Redis under one key, the way the backup
job keeps its own (`jobs/backup.py`), and the console reads it back.

Recording never raises: a Redis that is down costs the record, not the sweep, and a
console whose Redis is down is told "never run yet" rather than an error — the one answer
that is still true of what it can see.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass

from ..lib.redis import redis

log = logging.getLogger("blob.jobs.orphans")

#: Where the outcome of the last sweep is kept, for the Storage page.
LAST_KEY = "storage:sweep:last"


@dataclass(slots=True)
class Outcome:
    #: When the sweep ran, ISO 8601.
    ran_at: str
    #: Rows (and objects) removed.
    removed: int
    #: Their size, summed from the rows before they went.
    bytes: int
    #: What stopped the sweep, when something did; None for a clean run.
    error: str | None = None


async def record(outcome: Outcome) -> None:
    """Keep the outcome; a Redis that is down loses the record and nothing else."""
    try:
        await redis.set(LAST_KEY, json.dumps(asdict(outcome)))
    except Exception:
        log.warning("could not record the orphan sweep's outcome", exc_info=True)


async def last_outcome() -> Outcome | None:
    """The last sweep's outcome, or None before the first — or when it cannot be read."""
    try:
        raw = await redis.get(LAST_KEY)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return Outcome(**json.loads(raw))
    except (TypeError, ValueError):
        return None


__all__ = ["LAST_KEY", "Outcome", "last_outcome", "record"]
