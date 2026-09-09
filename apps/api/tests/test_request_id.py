"""A request id on every HTTP response, so a 500 is greppable."""

from __future__ import annotations

from .helpers import Client


class TestRequestId:
    async def test_every_answer_carries_one(self, client: Client) -> None:
        response = await client.get("/healthz")
        assert response.status == 200
        assert response.headers.get("x-request-id")

    async def test_an_incoming_id_is_echoed(self, client: Client) -> None:
        # helpers.Client may not expose custom headers — fall through httpx if needed.
        raw = client._http
        answer = await raw.get("/healthz", headers={"X-Request-ID": "from-the-proxy"})
        assert answer.headers.get("x-request-id") == "from-the-proxy"
