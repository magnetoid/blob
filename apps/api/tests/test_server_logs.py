"""Recent warnings and errors, where an operator can read them.

`/admin/health` says whether the parts answer and the audit log says who did what.
Neither says what went *wrong*, so the only account of a failure was the container's
stdout: behind shell access to the host, gone after a restart, and split across processes
on a box running more than one.

Two of these are about the handler not eating itself. A handler that reaches the network
to store a record can fail, and a failure that logs produces another record — so records
from the redis client are dropped, and the writer never logs, not even about being unable
to write. Both are load-bearing and neither is visible from the outside, which is exactly
the kind of thing that gets "simplified" away later.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
import pytest_asyncio

from blob_api.lib import logbuf

from .helpers import Client, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    """The first signup: owner of the first workspace, and the server's instance admin."""
    return await sign_up(client, "Founder")


async def drain() -> None:
    """Let the handler's fire-and-forget writes reach Redis.

    `emit` is synchronous and the store is not, so a record is scheduled rather than
    written. Nothing in production waits for this; a test has to.
    """
    for _ in range(5):
        await asyncio.sleep(0)
    await asyncio.sleep(0.05)


async def logs_of(founder: Client, query: str = "") -> list[dict]:
    response = await founder.get(f"/api/admin/instance/logs{query}")
    assert response.status == 200, response.body
    return list(response.body["entries"])


class TestWhatIsCaptured:
    async def test_a_warning_reaches_the_console(self, founder: Client) -> None:
        logging.getLogger("blob.test").warning("the disk is filling up")
        await drain()

        entries = await logs_of(founder)
        assert [e["message"] for e in entries] == ["the disk is filling up"]
        assert entries[0]["level"] == "WARNING"
        assert entries[0]["logger"] == "blob.test"

    async def test_an_exception_brings_its_traceback(self, founder: Client) -> None:
        try:
            raise ValueError("could not reach the runner")
        except ValueError:
            logging.getLogger("blob.test").exception("deploy failed")
        await drain()

        entry = (await logs_of(founder))[0]
        # The traceback is the whole reason to look, and it is also the part that would
        # be lost if this only stored the message.
        assert entry["detail"] is not None
        assert "ValueError: could not reach the runner" in entry["detail"]

    async def test_routine_chatter_is_not_kept(self, founder: Client) -> None:
        logging.getLogger("blob.test").info("served a request")
        logging.getLogger("blob.test").debug("cache hit")
        await drain()

        # A record of everything is a log file, and a log file is what this is not.
        assert await logs_of(founder) == []

    async def test_the_newest_is_first(self, founder: Client) -> None:
        for index in range(3):
            logging.getLogger("blob.test").warning("problem %d", index)
        await drain()

        assert [e["message"] for e in await logs_of(founder)] == [
            "problem 2",
            "problem 1",
            "problem 0",
        ]

    @pytest.mark.parametrize("muted", ["redis", "redis.connection", "blob.logbuf"])
    async def test_the_handlers_own_failures_are_dropped(self, founder: Client, muted: str) -> None:
        logging.getLogger(muted).error("connection refused")
        await drain()

        # Storing this would mean a dead Redis writes one record per failed attempt, and
        # each of those attempts fails and logs. That is the recursion this prevents.
        assert await logs_of(founder) == []


class TestReading:
    async def test_it_can_be_narrowed_to_errors(self, founder: Client) -> None:
        logging.getLogger("blob.test").warning("just a warning")
        logging.getLogger("blob.test").error("a real problem")
        await drain()

        entries = await logs_of(founder, "?level=error")
        assert [e["message"] for e in entries] == ["a real problem"]

    async def test_it_says_how_much_it_can_hold(self, founder: Client) -> None:
        response = await founder.get("/api/admin/instance/logs")
        # So the console can say the list is capped rather than implying it is the whole
        # history — this is a buffer, not an archive.
        assert response.body["capacity"] == logbuf.MAX_ENTRIES

    async def test_clearing_empties_it(self, founder: Client) -> None:
        logging.getLogger("blob.test").warning("dealt with")
        await drain()
        assert len(await logs_of(founder)) == 1

        assert (await founder.delete("/api/admin/instance/logs")).status == 200
        assert await logs_of(founder) == []

    async def test_clearing_is_audited(self, founder: Client) -> None:
        await founder.delete("/api/admin/instance/logs")
        actions = [e["action"] for e in (await founder.get("/api/admin/audit")).body["events"]]
        # The one action here that destroys evidence.
        assert "server_logs.cleared" in actions


class TestAccess:
    async def test_a_workspace_admin_is_not_an_instance_admin(self, founder: Client) -> None:
        admin = await invite_and_sign_up(founder, "Admin", role="admin")

        response = await admin.get("/api/admin/instance/logs")
        # A traceback is about the machine and can easily name a channel or an address
        # belonging to a workspace the reader is not in.
        assert response.status == 403
        assert (await admin.delete("/api/admin/instance/logs")).status == 403

    async def test_a_member_gets_nowhere(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        assert (await member.get("/api/admin/instance/logs")).status == 403

    async def test_a_stranger_gets_nowhere(self, founder: Client) -> None:
        assert (await founder.fork().get("/api/admin/instance/logs")).status == 401


class BrokenClient:
    """A client whose every command fails, the way one bound to a closed loop does."""

    async def lrange(self, *_args: object, **_kwargs: object) -> list[str]:
        raise RuntimeError("redis is gone")

    async def lpush(self, *_args: object, **_kwargs: object) -> int:
        raise RuntimeError("redis is gone")

    async def delete(self, *_args: object, **_kwargs: object) -> int:
        raise RuntimeError("redis is gone")

    async def aclose(self) -> None:
        return None


class TestItNeverBreaksAnything:
    async def test_a_broken_buffer_costs_diagnostics_and_nothing_else(
        self, founder: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(logbuf, "_redis", BrokenClient)

        # The page still renders, empty. Diagnostics failing must never be the thing that
        # takes the console down — that is the rule everywhere in this codebase.
        assert await logs_of(founder) == []

    async def test_a_failed_write_does_not_raise_into_the_caller(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(logbuf, "_redis", BrokenClient)

        # Logging a warning must not become a way to fail the request that logged it.
        logging.getLogger("blob.test").warning("something")
        await drain()

    async def test_it_does_not_share_the_client_everything_else_uses(self) -> None:
        from blob_api.lib import redis as shared

        # The reason this module has its own. A logging handler is called from anywhere,
        # a redis-py connection belongs to the loop that opened it, and a write scheduled
        # from a loop that is about to close leaves a dead connection in the pool. Shared,
        # that pool is presence, rate limiting and the pub/sub bridge — so diagnostics
        # would take down the thing they exist to diagnose. The suite caught this as
        # "Event loop is closed" in an unrelated fixture two files later.
        assert logbuf._redis() is not shared.redis
        assert logbuf._redis() is not shared.redis_sub
