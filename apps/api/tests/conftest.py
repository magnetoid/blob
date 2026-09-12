"""Test bootstrap.

Points every test at blob_test, runs migrations once, and gives every test a clean
slate. Tests run against real Postgres and Redis — the behaviour worth testing here
(idempotent inserts, unread math, the permission join) lives in SQL, and a mock would
only prove the mock works.
"""

from __future__ import annotations

import os

from .workers import worker_environment

os.environ.setdefault("NODE_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgres://blob:blob@localhost:5432/blob_test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("SESSION_SECRET", "test-secret-that-is-at-least-32-characters-long")
os.environ.setdefault("PUBLIC_URL", "http://localhost:5173")

# One database and one Redis db per xdist worker, or two workers would truncate each
# other mid-test. Forced, not defaulted: a developer's own DATABASE_URL still names the
# base, and the worker's suffix goes on top of whatever that is. `helpers.migrate_test_db`
# creates the database on first use. Without xdist this changes nothing.
os.environ.update(worker_environment(os.environ))

# Cheap password hashes. Every fixture that signs somebody up hashes once and verifies
# once at full argon2 strength otherwise — ~75 ms each, thousands of times a run. The
# profile is only honoured under NODE_ENV=test; see `lib/auth.build_hasher`.
os.environ["ARGON2_PROFILE"] = "fast"

# No model, whatever the developer's .env says.
#
# `config.Settings` reads the repo-root `.env`, so a developer who has configured a real
# provider was, until this line, running the suite with `llm.configured()` true and a
# live key in `settings`. That changes behaviour rather than just settings: the built-in
# agent is seeded into a workspace only when a model exists, so bootstrap counts and the
# "no model is configured" paths differ between that machine and CI — and anything that
# reached a provider would spend the developer's key to do it.
#
# Forced, not `setdefault`: `.env` does not go through `os.environ`, so a default would
# not beat it. Every test that wants a model already says so with
# `monkeypatch.setattr(settings, "LLM_PROVIDER", ...)`, which is the only way it should
# ever be on in here.
#
# `LLM_MODEL` belongs in this list as much as the other three, and leaving it out is how
# this was found: `test_summary_model` turns the provider on with monkeypatch and then
# asserts the *default* model for it, so a developer whose .env named a model watched two
# tests fail with `llm:deepseek-chat != llm:claude-sonnet-5` and nothing to explain it.
os.environ["LLM_PROVIDER"] = "disabled"
os.environ["LLM_API_KEY"] = ""
os.environ["LLM_BASE_URL"] = ""
os.environ["LLM_MODEL"] = ""

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, close_engine
from blob_api.lib.logbuf import close_log_buffer
from blob_api.lib.redis import close_redis, redis
from blob_api.realtime import hub

from .helpers import Client, build_client, migrate_test_db

#: `instance_admins` is keyed on an email rather than on a user, so it is the one table
#: that survives its workspace being deleted — and it was surviving the reset too. The
#: first person to found a workspace becomes the instance admin, so a stale row meant
#: "who is the instance admin?" depended on which test file happened to sign up first.
#: Tests asserting that a member is refused passed or failed on the alphabetical position
#: of unrelated files, which is how adding a test file broke three others.
TRUNCATE = """
TRUNCATE workspaces, users, sessions, invites, password_resets, channels,
         channel_members, messages, reactions, attachments, custom_emoji,
         read_states, thread_subscriptions, push_subscriptions, webhooks,
         audit_events, workspace_settings, themes, plugins, plugin_secrets,
         plugin_grants, plugin_deliveries, bot_tokens, instance_admins,
         activity_events
RESTART IDENTITY CASCADE
"""


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    migrate_test_db()


@pytest_asyncio.fixture(autouse=True)
async def _clean_state() -> None:
    """Wipe the database and Redis before every test.

    Every test, not every module: this fixture is function-scoped, which is what makes
    each test independent of the ones before it and is the reason the suite can be
    split across xdist workers at all.
    """
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
    await close_log_buffer()
    await close_redis()
    await close_engine()
