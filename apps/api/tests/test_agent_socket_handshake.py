"""The first frame an unauthenticated caller sends.

`_authenticate` read it with `json.loads`, caught `ValueError` for text that is not JSON,
and then called `frame.get("t")`. A JSON *scalar* is valid JSON — `123`, `"hi"`, `[1,2]`
all parse — so `.get` raised `AttributeError` and escaped the handler, on an endpoint
anybody can reach without a token. The client saw an abnormal close and the server wrote
a traceback into the log. `_read_loop`, ten lines further down, already checked
`isinstance(frame, dict)`; the handshake did not.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import WebSocketDisconnect, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport

from blob_api.main import app

pytestmark = pytest.mark.asyncio

#: Refused rather than crashed. 1008 is this endpoint's "no".
CLOSE_UNAUTHORIZED = 1008
CLOSE_BAD_FRAME = 1003


@contextlib.asynccontextmanager
async def mute_socket() -> AsyncIterator[Any]:
    """Connect with no Authorization header, so the first frame is the handshake."""
    async with AsyncClient(
        transport=ASGIWebSocketTransport(app=app), base_url="http://test"
    ) as http:
        async with aconnect_ws("/ws/agent", http) as ws:
            yield ws


async def _first_frame_close_code(payload: str) -> int:
    async with mute_socket() as ws:
        await ws.send_text(payload)
        try:
            await ws.receive_text()
        except WebSocketDisconnect as closed:
            return int(closed.code)
    raise AssertionError("the socket stayed open")


class TestAFirstFrameThatIsNotAnObject:
    @pytest.mark.parametrize("payload", ["123", '"hi"', "[1,2]", "true", "null"])
    async def test_is_refused_rather_than_crashing_the_handler(self, payload: str) -> None:
        assert await _first_frame_close_code(payload) == CLOSE_UNAUTHORIZED


class TestAFirstFrameThatIsNotJson:
    async def test_is_refused_as_a_bad_frame(self) -> None:
        # Already handled, and kept here so the two answers stay distinguishable.
        assert await _first_frame_close_code("not json at all") == CLOSE_BAD_FRAME


class TestAWellFormedFrameWithABadToken:
    async def test_is_refused_without_saying_why(self) -> None:
        payload = json.dumps({"t": "auth", "token": "nothing-real"})

        assert await _first_frame_close_code(payload) == CLOSE_UNAUTHORIZED
