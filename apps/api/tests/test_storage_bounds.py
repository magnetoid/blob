"""Reading an object never holds more of it than the caller agreed to.

`get_object` used to read whatever was stored, and what was stored was whatever a
browser chose to PUT. These run without object storage: the client is a stand-in.
"""

from __future__ import annotations

import io
from typing import Any

import pytest

from blob_api.lib import storage


class _Body(io.BytesIO):
    pass


def _client_returning(data: bytes, declared: int | None) -> Any:
    class _Client:
        def get_object(self, **_kwargs: Any) -> dict[str, Any]:
            answer: dict[str, Any] = {"Body": _Body(data)}
            if declared is not None:
                answer["ContentLength"] = declared
            return answer

    return _Client()


async def test_within_the_bound_it_reads_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(storage, "_client", lambda: _client_returning(b"x" * 10, 10))
    assert await storage.get_object("k", max_bytes=10) == b"x" * 10


async def test_a_declared_length_over_the_bound_is_refused_before_reading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(storage, "_client", lambda: _client_returning(b"x" * 100, 100))
    with pytest.raises(storage.ObjectTooLargeError):
        await storage.get_object("k", max_bytes=10)


async def test_a_body_longer_than_it_declared_is_still_cut_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(storage, "_client", lambda: _client_returning(b"x" * 100, None))
    with pytest.raises(storage.ObjectTooLargeError):
        await storage.get_object("k", max_bytes=10)
