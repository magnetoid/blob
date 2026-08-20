"""Test bootstrap.

Points every test at blob_test, runs migrations once, and gives each test module a clean
slate. Tests run against real Postgres and Redis — the behaviour worth testing here
(idempotent inserts, unread math, the permission join) lives in SQL, and a mock would
only prove the mock works.
"""

from __future__ import annotations

import os

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgres://blob:blob@localhost:5432/blob_test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("SESSION_SECRET", "test-secret-that-is-at-least-32-characters-long")
os.environ.setdefault("PUBLIC_URL", "http://localhost:5173")

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, close_engine
from blob_api.lib.redis import close_redis, redis
from blob_api.realtime import hub

from .helpers import Client, build_client, migrate_test_db

TRUNCATE = """
TRUNCATE workspaces, users, sessions, invites, password_resets, channels,
         channel_members, messages, reactions, attachments, custom_emoji,
         read_states, thread_subscriptions, push_subscriptions, webhooks,
         audit_events, workspace_settings, themes, plugins, plugin_secrets,
         plugin_grants, plugin_deliveries, bot_tokens
RESTART IDENTITY CASCADE
"""


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    migrate_test_db()


@pytest_asyncio.fixture(autouse=True)
async def _clean_state() -> None:
    """Wipe the database and Redis before each test module's fixtures build state."""
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(text(TRUNCATE))
    # Rate-limit counters and presence live in Redis and would otherwise leak between
    # runs — a previous run's signup attempts would exhaust this run's budget.
    await redis.flushdb()
    hub.reset_for_tests()


@pytest_asyncio.fixture
async def client() -> Client:
    async with build_client() as c:
        yield c


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _shutdown() -> None:
    yield
    await close_redis()
    await close_engine()
