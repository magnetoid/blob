"""Database access.

One async engine, one session factory, and a transaction helper whose whole job is to
make persist-then-broadcast structural: side effects registered inside the block are
drained only after COMMIT. Emitting mid-transaction is the classic bug where a client
fetches a message the database hasn't committed yet.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy import Row, event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.util import await_only

from ..config import settings

engine: AsyncEngine = create_async_engine(
    settings.sqlalchemy_url,
    pool_size=4 if settings.is_test else 20,
    max_overflow=0 if settings.is_test else 10,
    pool_pre_ping=True,
    echo=False,
)


@event.listens_for(engine.sync_engine, "connect")
def _register_codecs(dbapi_connection: Any, _record: Any) -> None:
    """Return uuid columns as strings.

    Ids are UUIDv7 and the whole unread model rests on comparing them as strings — the
    ORM is configured for that, but hand-written `text()` queries bypass the ORM's type
    layer and would otherwise hand back `uuid.UUID` objects. Registering the codec on
    the connection keeps both paths identical.
    """
    raw = dbapi_connection.driver_connection

    async def setup() -> None:
        await raw.set_type_codec(
            "uuid", encoder=str, decoder=str, schema="pg_catalog", format="text"
        )

    await_only(setup())


log = logging.getLogger("blob.db.engine")

SessionFactory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


class AfterCommit:
    """Collects callbacks to run once the surrounding transaction has committed."""

    def __init__(self) -> None:
        self._callbacks: list[Callable[[], Any]] = []

    def add(self, fn: Callable[[], Any]) -> None:
        self._callbacks.append(fn)

    def drain(self) -> None:
        # Each callback is on its own. The write has already committed by the time
        # these run, so a broadcast that raises must not turn a successful request
        # into a 500 — and must not eat the broadcasts queued behind it.
        for fn in self._callbacks:
            try:
                fn()
            except Exception:
                log.exception("after-commit callback failed")
        self._callbacks.clear()


@asynccontextmanager
async def transaction() -> AsyncIterator[tuple[AsyncSession, AfterCommit]]:
    """Run work in a transaction; broadcast only after it commits.

    Anything registered on the returned AfterCommit runs past COMMIT, so it is
    structurally impossible to emit an event for a row that never landed.
    """
    after = AfterCommit()
    async with SessionFactory() as session:
        async with session.begin():
            yield session, after
    after.drain()


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """A read-only session for handlers that do not write."""
    async with SessionFactory() as session:
        yield session


async def fetch_all(
    session: AsyncSession, sql: str, params: dict[str, Any] | None = None
) -> Sequence[Row[Any]]:
    """Run hand-written SQL. The chat queries stay verbatim rather than being
    re-expressed as query-builder chains — they are tuned, and they are tested."""
    result = await session.execute(text(sql), params or {})
    return result.fetchall()


async def fetch_one(
    session: AsyncSession, sql: str, params: dict[str, Any] | None = None
) -> Row[Any] | None:
    result = await session.execute(text(sql), params or {})
    return result.fetchone()


async def execute(session: AsyncSession, sql: str, params: dict[str, Any] | None = None) -> None:
    await session.execute(text(sql), params or {})


async def close_engine() -> None:
    await engine.dispose()
