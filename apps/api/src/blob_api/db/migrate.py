"""Apply migrations at boot.

Called by the container entrypoint before the server starts. Two things make it safe to
run on every boot rather than as a manual step:

* An advisory lock, so replicas booting together do not race. The second one waits, then
  finds the schema already at head and returns immediately.
* A bounded wait for the database, so a stack whose Postgres is still accepting its first
  connections starts rather than crash-loops.

Run it by hand with:  python -m blob_api.db.migrate
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from ..config import settings

log = logging.getLogger("blob.migrate")

#: 'blob' in ASCII, so the lock is recognisable in pg_locks when something is stuck.
LOCK_KEY = 0x626C6F62

CONNECT_ATTEMPTS = 30
CONNECT_DELAY_SEC = 2.0


def alembic_config() -> Config:
    """The same alembic.ini the CLI uses, found relative to this file.

    Located by walking up rather than hardcoded, because the layout differs between an
    editable install in the repo and the copy inside the image.
    """
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "alembic.ini"
        if candidate.is_file():
            config = Config(str(candidate))
            config.set_main_option("script_location", str(directory / "src/blob_api/db/migrations"))
            return config
    raise RuntimeError("alembic.ini not found above " + str(Path(__file__).resolve()))


async def _wait_for_database(engine: AsyncEngine) -> None:
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            return
        except Exception as exc:
            # Deliberately broad: a database that is not up yet fails in several ways,
            # and every one of them is worth another try.
            if attempt == CONNECT_ATTEMPTS:
                raise
            log.info("database not ready (%s), retrying %d/%d", exc, attempt, CONNECT_ATTEMPTS)
            await asyncio.sleep(CONNECT_DELAY_SEC)


async def _upgrade() -> None:
    engine = create_async_engine(
        settings.sqlalchemy_url, poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        await _wait_for_database(engine)
        async with engine.connect() as connection:
            await connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": LOCK_KEY})
            try:
                # Alembic's env.py opens its own event loop, so it has to run off this one.
                await asyncio.to_thread(command.upgrade, alembic_config(), "head")
            finally:
                await connection.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY}
                )
    finally:
        await engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-5.5s [%(name)s] %(message)s")
    # Alembic's own logging config sets the root logger to WARNING as a side effect, so
    # this logger states its level rather than inheriting one.
    log.setLevel(logging.INFO)
    log.info("migrating")
    asyncio.run(_upgrade())
    log.info("schema is at head")


if __name__ == "__main__":
    main()
