"""What a dial-in agent may not do, and what it may not be told to do.

`test_agent_socket.py` covers the happy path: an agent connects, is sent a run, answers.
This covers the edges that were open — three of which were silent, and one of which was a
cross-tenant hole.

The sharpest is run ownership. Runs travel over a shared Redis channel addressed by id, and
until now nothing checked that the agent sending events for a run was the agent that had
been asked to do it. Any authenticated bot, in any workspace, could publish into any run id
it named: fabricated text posted as *another* agent's reply, or a `RUN_ERROR` to kill its
run. The only thing standing in the way was that a UUIDv7 is hard to guess, which is a
reason it had not happened rather than a reason it could not.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest_asyncio
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport

from blob_api.main import app
from blob_api.plugins import gateway

from .helpers import Client, sign_up
from .test_agent_socket import (
    _no_leaked_connections,  # noqa: F401 — autouse barrier, needed here for the same reason
)
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse, needed here too

AGENT: dict[str, Any] = {
    "slug": "desktop-agent",
    "name": "Desktop",
    "runtime": "socket",
    "version": "1.0.0",
    "events": [],
    "scopes": ["messages:read", "messages:write"],
}


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Owner")


async def install(owner: Client, **overrides: Any) -> dict:
    response = await owner.post("/api/admin/plugins", {**AGENT, **overrides})
    assert response.status == 201, response.body
    return dict(response.body)


@contextlib.asynccontextmanager
async def agent_socket(token: str) -> AsyncIterator[Any]:
    async with AsyncClient(
        transport=ASGIWebSocketTransport(app=app), base_url="http://test"
    ) as http:
        async with aconnect_ws(
            "/ws/agent", http, headers={"authorization": f"Bearer {token}"}
        ) as ws:
            yield ws


async def receive_until(ws: Any, kind: str, timeout: float = 5.0) -> dict:
    async def pump() -> dict:
        while True:
            frame = json.loads(await ws.receive_text())
            if frame.get("t") == kind:
                return dict(frame)

    return await asyncio.wait_for(pump(), timeout)


class TestOwningARun:
    async def test_an_agent_may_answer_the_run_it_claimed(self) -> None:
        await gateway.redis.set(gateway.claim_key("run-mine"), "plugin-a", ex=60)

        assert await gateway.owns_run("plugin-a", "run-mine") is True

    async def test_another_agent_may_not(self) -> None:
        await gateway.redis.set(gateway.claim_key("run-theirs"), "plugin-a", ex=60)

        # The hole this closes: `plugin-b` could publish TEXT_MESSAGE_* into this run and
        # have it posted under plugin-a's name, or RUN_ERROR to end it.
        assert await gateway.owns_run("plugin-b", "run-theirs") is False

    async def test_a_run_nobody_claimed_is_refused(self) -> None:
        # Refused rather than allowed. An unclaimed id is either expired — past its
        # deadline, with nobody listening — or invented.
        assert await gateway.owns_run("plugin-a", "run-that-never-existed") is False

    async def test_an_event_for_someone_elses_run_is_dropped(self, owner: Client) -> None:
        mine = await install(owner, slug="mine", name="Mine")
        theirs = await install(owner, slug="theirs", name="Theirs")
        run_id = "run-cross-tenant"
        await gateway.redis.set(gateway.claim_key(run_id), str(theirs["plugin"]["id"]), ex=60)

        published: list[tuple[str, Any]] = []
        original = gateway.redis.publish

        async def watch(channel: str, payload: Any) -> Any:
            published.append((channel, payload))
            return await original(channel, payload)

        gateway.redis.publish = watch  # type: ignore[method-assign]
        try:
            async with agent_socket(str(mine["botToken"])) as ws:
                await receive_until(ws, "ready")
                await ws.send_text(
                    json.dumps(
                        {
                            "t": "event",
                            "runId": run_id,
                            "event": {
                                "type": "TEXT_MESSAGE_CHUNK",
                                "messageId": "m",
                                "delta": "I am not who you asked",
                            },
                        }
                    )
                )
                # Round-trip something the server does answer, so the event frame above
                # has demonstrably been processed rather than merely not arrived yet.
                await ws.send_text('{"t":"ping"}')
                await receive_until(ws, "pong")
        finally:
            gateway.redis.publish = original  # type: ignore[method-assign]

        assert not [c for c, _ in published if c == gateway.event_channel(run_id)]


class TestWhatASocketAgentCannotDeclare:
    """Configuration that installs cleanly and then quietly does nothing."""

    async def test_events_are_refused(self, owner: Client) -> None:
        response = await owner.post("/api/admin/plugins", {**AGENT, "events": ["message.created"]})

        # There is no frame for a webhook delivery on this transport. Accepted, these
        # piled up as `pending` deliveries forever — a rising number in the console with
        # no failure attached to it.
        assert response.status == 400
        assert response.body["error"]["code"] == "events_not_supported"

    async def test_commands_are_refused(self, owner: Client) -> None:
        response = await owner.post(
            "/api/admin/plugins",
            {
                **AGENT,
                "scopes": [*AGENT["scopes"], "commands"],
                "commands": [{"name": "deploy", "summary": "Ship it"}],
            },
        )

        # Worse than dead: command names are unique per workspace, so this squatted
        # `/deploy` for everyone while refusing to answer it.
        assert response.status == 400
        assert response.body["error"]["code"] == "commands_not_supported"


class TestEditingASocketAgent:
    async def test_a_url_cannot_be_added_afterwards(self, owner: Client) -> None:
        body = await install(owner)
        plugin_id = body["plugin"]["id"]

        response = await owner.put(
            f"/api/admin/plugins/{plugin_id}",
            {**AGENT, "aguiUrl": "https://apps.example.com/agui"},
        )

        # `POST` refused this and `PUT` did not, so the guard was one request away from
        # being bypassed — leaving a row that answers "where is it?" twice.
        assert response.status == 400
        assert response.body["error"]["code"] == "url_not_allowed"

    async def test_an_ordinary_edit_still_works(self, owner: Client) -> None:
        body = await install(owner)
        plugin_id = body["plugin"]["id"]

        response = await owner.put(
            f"/api/admin/plugins/{plugin_id}", {**AGENT, "name": "Desktop Renamed"}
        )

        assert response.status == 200, response.body
        assert response.body["name"] == "Desktop Renamed"


class TestSeeingWhetherItIsConnected:
    async def test_a_socket_agent_reports_offline_before_it_dials(self, owner: Client) -> None:
        await install(owner)

        [plugin] = (await owner.get("/api/admin/plugins")).body["plugins"]

        # False, not absent. Until this existed the only way to find out was to mention
        # the agent and wait to see whether anything happened.
        assert plugin["online"] is False

    async def test_it_reports_online_while_it_holds_the_socket(self, owner: Client) -> None:
        body = await install(owner)

        async with agent_socket(str(body["botToken"])) as ws:
            await receive_until(ws, "ready")
            [plugin] = (await owner.get("/api/admin/plugins")).body["plugins"]

        assert plugin["online"] is True

    async def test_a_hosted_app_has_no_opinion(self, owner: Client) -> None:
        await owner.post(
            "/api/admin/plugins",
            {
                "slug": "webhook-app",
                "name": "Webhook",
                "runtime": "external",
                "version": "1.0.0",
                "requestUrl": "https://apps.example.com/blob/events",
                "events": [],
                "scopes": ["messages:read"],
            },
        )

        plugins = (await owner.get("/api/admin/plugins")).body["plugins"]
        [webhook] = [p for p in plugins if p["slug"] == "webhook-app"]

        # `null`, not `false`. The question is meaningless for an app Blob calls, and a
        # `false` on that row would read as "broken".
        assert webhook["online"] is None
