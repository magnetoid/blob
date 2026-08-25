"""Recent warnings and errors, kept where an operator can read them.

`/admin/health` says whether the database and Redis answer; the audit log says who did
what. Neither says *what went wrong*, so the only account of a failure was the container's
stdout — which needs shell access to the host, is gone after a restart, and on a machine
running several app processes is several files that have to be read together.

A capped Redis list instead. Redis is already a hard dependency; `LPUSH` + `LTRIM` bounds
it without a sweeper; every app process and the worker write to the same list, so the
operator sees one timeline rather than one per container; and it outlives a restart of
the app while costing nothing when Redis itself restarts. Losing this must be survivable,
because it is diagnostics — the workspace stays up, which is the rule everywhere here.

Only WARNING and above. A record of every request is a log file, and a log file is what
this deliberately is not: this is the short list somebody scans when they suspect
something is wrong.

The dangerous part is recursion. A handler that reaches the network to store a record can
fail, and a failure that logs produces another record, which fails, which logs. Two guards
below, and they are not optional: records from the redis client itself are dropped, and
the writer never logs — not even about being unable to write.

**Its own client, deliberately.** This does not share `lib.redis.redis`. A logging handler
is called from anywhere, including from code running on a loop that is about to go away,
and a redis-py connection belongs to the loop that opened it — so a write scheduled from
the wrong place can leave a dead connection in the pool. Sharing the pool would mean that
poisons presence, rate limiting and the pub/sub bridge: diagnostics taking down the thing
they are diagnosing. The suite caught exactly this. A private client also keeps a burst of
logging from eating pool slots at the moment the system is under stress and logging most,
and it means a failure can be answered by throwing the client away and starting again,
which is not something a shared pool can survive.
"""

from __future__ import annotations

import json
import logging
import traceback
from typing import Any

from redis.asyncio import Redis

from ..config import settings

#: The list, newest first, so a read is `LRANGE 0 n` with no reversal.
LOG_KEY = "blob:logs"

#: Roughly a screenful per page for fifty pages. Past that, an operator needs the real
#: log shipper this is explicitly not trying to be.
MAX_ENTRIES = 500

#: A traceback is the useful part and also the unbounded one.
TRACEBACK_CHARS = 4000

#: Loggers whose own failures would be caused by this handler's writes. Dropping them is
#: what stops one dead Redis connection from writing a record per attempt, for ever.
_MUTED_PREFIXES = ("redis", "blob.logbuf")

log = logging.getLogger("blob.logbuf")

#: Bounds a runaway even if the prefix guard is somehow bypassed — a hard stop rather
#: than a clever one, because the failure mode is an unbounded task fan-out.
_MAX_IN_FLIGHT = 64
_in_flight = 0

_client: Redis | None = None


def _redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


async def _discard_client() -> None:
    """Throw the client away so the next call builds a fresh one.

    The failure this exists for is a connection bound to a loop that has since closed:
    it never recovers, and every later call fails the same way. Reconnecting is the only
    repair, and it is cheap because this is the only user of this pool.
    """
    global _client
    client, _client = _client, None
    if client is None:
        return
    try:
        await client.aclose()
    except Exception:
        pass


async def close_log_buffer() -> None:
    """Shutdown hook, so the process does not exit holding a socket open."""
    await _discard_client()


def _entry_for(record: logging.LogRecord) -> dict[str, Any]:
    detail: str | None = None
    if record.exc_info:
        detail = "".join(traceback.format_exception(*record.exc_info))[:TRACEBACK_CHARS]

    return {
        # The client wants milliseconds and Z, like every other timestamp here.
        "at": _iso(record.created),
        "level": record.levelname,
        "logger": record.name,
        "message": record.getMessage()[:2000],
        "detail": detail,
        # Set by `main._unhandled` via `extra=`, so the console can say which endpoint
        # blew up rather than only that something did. Absent on everything else.
        "path": getattr(record, "request_path", None),
        "method": getattr(record, "request_method", None),
    }


def _iso(epoch: float) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(epoch, UTC).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


async def _write(payload: str) -> None:
    """Store one record. Never raises, and never logs — see the module docstring."""
    global _in_flight
    try:
        # redis-py types its list commands as the sync/async union it inherits from the
        # shared mixin, so `await` on them is what mypy objects to — not the call. Same
        # escape hatch `hub.py` and `gateway.py` use on `pubsub.aclose()`.
        client = _redis()
        await client.lpush(LOG_KEY, payload)  # type: ignore[misc]
        await client.ltrim(LOG_KEY, 0, MAX_ENTRIES - 1)  # type: ignore[misc]
    except Exception:
        # Deliberately silent. Any report of this failure is itself a record, and the
        # thing that would carry it is the thing that just failed.
        await _discard_client()
    finally:
        _in_flight -= 1


class RedisLogHandler(logging.Handler):
    """Copies WARNING and above into Redis. Attached to the root logger."""

    def emit(self, record: logging.LogRecord) -> None:
        global _in_flight
        if record.name.startswith(_MUTED_PREFIXES):
            return
        if _in_flight >= _MAX_IN_FLIGHT:
            return

        try:
            payload = json.dumps(_entry_for(record))
        except Exception:
            return

        # Imported here rather than at module scope: `lib.queue` imports config, and a
        # logging handler is installed early enough for that to matter.
        from .queue import fire_and_forget

        try:
            _in_flight += 1
            fire_and_forget(_write(payload))
        except RuntimeError:
            # No running loop — a record from import time or from a worker shutting
            # down. Dropping it is correct; there is nothing to schedule on.
            _in_flight -= 1
        except Exception:
            _in_flight -= 1


_installed = False


def install_log_capture() -> None:
    """Attach the handler to the root logger, once.

    Root rather than `blob`, because the records worth seeing most are the ones this
    codebase does not emit: an unhandled exception while serving a request is logged by
    the server, under its own logger name.
    """
    global _installed
    if _installed:
        return
    _installed = True

    handler = RedisLogHandler()
    handler.setLevel(logging.WARNING)
    logging.getLogger().addHandler(handler)


async def read_logs(limit: int = 100, level: str | None = None) -> list[dict[str, Any]]:
    """Newest first. A bad row is skipped rather than failing the page."""
    try:
        raw = await _redis().lrange(LOG_KEY, 0, MAX_ENTRIES - 1)  # type: ignore[misc]
    except Exception:
        await _discard_client()
        log.warning("could not read the log buffer", exc_info=True)
        return []

    entries: list[dict[str, Any]] = []
    for item in raw:
        try:
            entry = json.loads(item)
        except (TypeError, ValueError):
            continue
        if level and entry.get("level") != level:
            continue
        entries.append(entry)
        if len(entries) >= limit:
            break
    return entries


async def clear_logs() -> None:
    """Empty the list — 'I have dealt with these', which is the only state this has."""
    try:
        await _redis().delete(LOG_KEY)
    except Exception:
        await _discard_client()
        log.warning("could not clear the log buffer", exc_info=True)
