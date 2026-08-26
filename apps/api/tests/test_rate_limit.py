"""The limiter is a guard on the write path, not part of it."""

from __future__ import annotations

import pytest

from blob_api.lib import rate_limit
from blob_api.lib.errors import AppError

from .helpers import Client, send_message, sign_up


class _DeadPipeline:
    """A Redis client whose pipeline fails the way a dead server fails."""

    def pipeline(self, transaction: bool = True) -> _DeadPipeline:
        return self

    async def __aenter__(self) -> _DeadPipeline:
        raise ConnectionError("redis is away")

    async def __aexit__(self, *exc: object) -> None:  # pragma: no cover
        return None


async def test_a_redis_outage_does_not_block_the_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Patch the name the module owns: `consume` reads `rate_limit.redis`.
    monkeypatch.setattr(rate_limit, "redis", _DeadPipeline())
    # Fails open — no exception, no 429. Before this, a Redis blip 500'd message
    # sending, login, search and uploads at once.
    await rate_limit.consume("send_message", "someone")


async def test_a_legitimate_429_still_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FullPipeline:
        def pipeline(self, transaction: bool = True) -> _FullPipeline:
            return self

        async def __aenter__(self) -> _FullPipeline:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        def zremrangebyscore(self, *a: object) -> None: ...
        def zcard(self, *a: object) -> None: ...
        def zadd(self, *a: object) -> None: ...
        def expire(self, *a: object) -> None: ...

        async def execute(self) -> list[int]:
            return [0, 10_000, 1, 1]

    monkeypatch.setattr(rate_limit, "redis", _FullPipeline())
    with pytest.raises(AppError) as caught:
        await rate_limit.consume("send_message", "someone")
    assert caught.value.status_code == 429


async def test_the_workspace_stays_usable_end_to_end(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Owner")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")

    monkeypatch.setattr(rate_limit, "redis", _DeadPipeline())
    response = await send_message(owner, general["id"], "still here")
    assert response.status in (200, 201), response.body
