"""The HTTP contract Coolify actually enforces.

Every other agent test stubs the runner, which is right for asserting Blob's half of an
install but means no test ever sees a URL or a verb. That gap had already cost three
defects that only a live call could surface — a missing destination_uuid, an fqdn that
arrived with a scheme, and a setting named after one Coolify injects itself — and it hid
a fourth: `stop` was written as a GET, and Coolify answers that with

    405 {"message":"This endpoint has changed to a POST request."}

so every stop an admin asked for came back as runner_failed. The lifecycle verbs moved to
POST; status and logs did not. That asymmetry is the whole reason this file exists: it is
not guessable from the shape of the API, so it is pinned here rather than rediscovered.

These assert the request the runner makes, not the reply it gets. A mock transport cannot
tell us what Coolify accepts — only a live call does that, and the values below were taken
from one against 4.3.9.
"""

from __future__ import annotations

import httpx
import pytest

from blob_api.plugins import runner as runner_module
from blob_api.plugins.runner import CoolifyRunner


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Capture (method, path) for everything the runner sends."""
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={"uuid": "app-uuid", "status": "running"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def fake_client(**kwargs: object) -> httpx.AsyncClient:
        kwargs.pop("transport", None)
        return real_client(**kwargs, transport=transport)  # type: ignore[arg-type]

    monkeypatch.setattr(runner_module.httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(runner_module.settings, "COOLIFY_API_URL", "http://runner.invalid")
    monkeypatch.setattr(runner_module.settings, "COOLIFY_TOKEN", "token")
    return seen


async def test_stopping_an_agent_is_a_post(calls: list[tuple[str, str]]) -> None:
    # A GET here is a 405 from Coolify, not a stopped agent.
    await CoolifyRunner().stop("app-uuid")
    assert calls == [("POST", "/api/v1/applications/app-uuid/stop")]


async def test_reading_state_stays_on_get(calls: list[tuple[str, str]]) -> None:
    # The counterpart to the rule above: only the verbs that change something moved.
    runner = CoolifyRunner()
    await runner.status("app-uuid")
    await runner.logs("app-uuid", lines=10)
    assert [method for method, _ in calls] == ["GET", "GET"]


async def test_a_redeploy_asks_the_deploy_endpoint_to_force(calls: list[tuple[str, str]]) -> None:
    await CoolifyRunner().redeploy("app-uuid")
    assert calls == [("POST", "/api/v1/deploy")]
