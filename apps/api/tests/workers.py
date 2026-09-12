"""Where each pytest-xdist worker keeps its state.

Every test starts by wiping the database and Redis, so two workers sharing either would
wipe each other mid-test. Each worker therefore gets a database and a Redis db of its
own, named from its worker id. This module is imported by `conftest.py` *before*
`blob_api` is, because `blob_api.config` reads the URLs the moment it loads — so nothing
here may import the application.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

_WORKER = re.compile(r"^gw(\d+)$")


def worker_index(worker: str) -> int:
    """`gw3` → 3. xdist names workers this way and nothing else does."""
    match = _WORKER.match(worker)
    if match is None:
        raise ValueError(f"not an xdist worker id: {worker!r}")
    return int(match.group(1))


def per_worker_database(url: str, worker: str) -> str:
    """`…/blob_test` → `…/blob_test_gw3`, keeping any query string where it was."""
    base, _, query = url.partition("?")
    head, _, name = base.rpartition("/")
    if not name:
        raise ValueError(f"database URL names no database: {url!r}")
    renamed = f"{head}/{name}_{worker}"
    return f"{renamed}?{query}" if query else renamed


def per_worker_redis(url: str, worker: str) -> str:
    """`redis://…/15` → `redis://…/12` for `gw3`: counting down from the configured db.

    Redis ships sixteen databases and the suite's is the last one, so counting down keeps
    the workers clear of a development instance living in db 0.
    """
    base, _, query = url.partition("?")
    head, _, db = base.rpartition("/")
    top = int(db) if db.isdigit() else 0
    chosen = top - worker_index(worker)
    if chosen < 0:
        raise ValueError(f"no Redis db left for {worker!r} counting down from {top}")
    renamed = f"{head}/{chosen}" if db.isdigit() else f"{base}/{chosen}"
    return f"{renamed}?{query}" if query else renamed


def worker_environment(environ: Mapping[str, str]) -> dict[str, str]:
    """The overrides for this process: a database and a Redis db of its own under
    xdist, nothing at all otherwise.

    Returned rather than applied so `conftest.py` can write it as one
    `os.environ.update(...)` — the shape ruff lets precede the imports that follow.
    """
    worker = environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return {}
    return {
        "DATABASE_URL": per_worker_database(environ["DATABASE_URL"], worker),
        "REDIS_URL": per_worker_redis(environ["REDIS_URL"], worker),
    }
