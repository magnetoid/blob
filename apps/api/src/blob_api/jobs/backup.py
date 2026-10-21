"""Nightly database backups (M3 · B4).

`pg_dump --format=custom`, run by the worker and streamed into object storage as it is
written — no temporary file, no memory to hold it — under `BACKUP_PREFIX`, one object per
night, the oldest deleted once there are `BACKUP_KEEP_DAYS` days of them (never the newest).
The password goes to `pg_dump` in its environment, not its arguments, where anybody in the
container could read it in `ps`.

A failed dump leaves no half object behind, and the outcome of the last attempt is kept in
Redis for the Health page, so a backup that stopped working is something an admin sees on a
page they already open rather than discovers the day they need it.

The restore is `scripts/restore-drill.sh`, run against a copy fetched with
`python -m blob_api.backups latest`; `docs/backup.md` says how, and what it costs in time.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.engine import make_url

from ..config import settings
from ..lib import storage
from ..lib.redis import redis

log = logging.getLogger("blob.jobs.backup")

#: Where the outcome of the last attempt is kept, for the Health page.
LAST_KEY = "backup:last"


@dataclass(slots=True)
class Outcome:
    at: str
    ok: bool
    key: str | None = None
    bytes: int | None = None
    seconds: float | None = None
    error: str | None = None


class BackupError(Exception):
    """`pg_dump` said no; its last line of complaint is the message."""


def _pg_environment() -> dict[str, str]:
    """The connection, as libpq reads it from the environment."""
    url = make_url(settings.DATABASE_URL)
    env = {**os.environ}
    for name, value in (
        ("PGHOST", url.host),
        ("PGPORT", str(url.port) if url.port else None),
        ("PGUSER", url.username),
        ("PGPASSWORD", url.password),
        ("PGDATABASE", url.database),
    ):
        if value:
            env[name] = str(value)
    return env


class _Counting:
    """The dump's stdout, counting what passes through on its way to the bucket."""

    def __init__(self, stream: Any) -> None:
        self.stream = stream
        self.total = 0

    def read(self, size: int = -1) -> bytes:
        chunk: bytes = self.stream.read(size)
        self.total += len(chunk)
        return chunk


def _dump_into(key: str, bucket: str) -> int:
    """Run `pg_dump` and stream it up. Blocking: called from a thread."""
    command = [
        settings.BACKUP_PG_DUMP,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
    ]
    with subprocess.Popen(  # noqa: S603 — a fixed argv, no shell, the binary from settings
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_pg_environment(),
    ) as process:
        assert process.stdout is not None and process.stderr is not None  # noqa: S101
        counted = _Counting(process.stdout)
        try:
            storage.upload_stream(key, counted, bucket=bucket)
        finally:
            error = process.stderr.read().decode("utf-8", errors="replace")
            code = process.wait()
    if code != 0:
        # The upload finished with whatever the dump wrote before it died: not a backup.
        try:
            storage.remove_object(key, bucket=bucket)
        except Exception:
            log.warning("could not remove the failed backup %s", key, exc_info=True)
        raise BackupError(error.strip().splitlines()[-1] if error.strip() else f"exit {code}")
    return counted.total


def _prune(bucket: str, now: datetime) -> int:
    """Delete what is past `BACKUP_KEEP_DAYS`, never the newest. Blocking."""
    objects = sorted(
        storage.list_objects(settings.BACKUP_PREFIX, bucket=bucket),
        key=lambda item: item["LastModified"],
    )
    cutoff = now - timedelta(days=settings.BACKUP_KEEP_DAYS)
    removed = 0
    for item in objects[:-1]:
        if item["LastModified"] < cutoff:
            storage.remove_object(item["Key"], bucket=bucket)
            removed += 1
    return removed


async def run_backup(now: datetime | None = None) -> Outcome | None:
    """One backup, and the record of how it went. None when backups are switched off."""
    if not settings.BACKUP_ENABLED:
        return None
    now = now or datetime.now(UTC)
    bucket = storage.backup_bucket()
    key = f"{settings.BACKUP_PREFIX}blob-{now:%Y%m%dT%H%M%SZ}.dump"
    if shutil.which(settings.BACKUP_PG_DUMP) is None:
        outcome = Outcome(
            at=now.isoformat(),
            ok=False,
            error=f"{settings.BACKUP_PG_DUMP} is not installed where the worker runs.",
        )
    else:
        started = asyncio.get_running_loop().time()
        try:
            size = await asyncio.to_thread(_dump_into, key, bucket)
            removed = await asyncio.to_thread(_prune, bucket, now)
            outcome = Outcome(
                at=now.isoformat(),
                ok=True,
                key=key,
                bytes=size,
                seconds=round(asyncio.get_running_loop().time() - started, 1),
            )
            log.info("backed up to %s (%d bytes, %d old removed)", key, size, removed)
        except BackupError as failure:
            outcome = Outcome(at=now.isoformat(), ok=False, error=str(failure))
        except Exception as failure:  # storage down, mostly: recorded, not raised
            log.warning("backup failed", exc_info=True)
            outcome = Outcome(at=now.isoformat(), ok=False, error=str(failure) or "failed")
    await redis.set(LAST_KEY, json.dumps(asdict(outcome)))
    return outcome


async def last_outcome() -> Outcome | None:
    raw = await redis.get(LAST_KEY)
    if not raw:
        return None
    try:
        return Outcome(**json.loads(raw))
    except (TypeError, ValueError):
        return None


__all__ = ["LAST_KEY", "BackupError", "Outcome", "last_outcome", "run_backup"]
