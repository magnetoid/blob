"""An agent that dials in.

Every other runtime is reached by Blob calling an address. A `socket` agent has none —
it runs on somebody's laptop, behind NAT — so it opens a WebSocket to Blob and holds it,
and runs are written down that pipe. See `plugins/gateway`.

Three things are worth testing and one of them is not obvious:

* **Authentication**, which is the same bot token the callback API takes, and which must
  refuse a disabled app exactly as the HTTP path does.
* **The round trip** — a mention reaches the agent over the socket and its answer lands
  in the channel — which is the whole feature.
* **The part that is not obvious: the process holding the socket is not the process
  running the job.** Mentions are handled by the worker; sockets are held by an API
  process. Every run crosses processes through Redis, which is where the interesting
  failures live: publishing before anyone is subscribed, and a run that arrives at two
  holders and gets answered twice.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest_asyncio
from httpx import AsyncClient
from httpx_ws import WebSocketDisconnect, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.main import app
from blob_api.plugins import gateway

from .helpers import Client, invite_and_sign_up, send_message, sign_up

AGENT = {
    "slug": "desktop",
    "name": "Desktop",
    "runtime": "socket",
    "version": "1.0.0",
    "events": [],
    "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"],
}


@pytest_asyncio.fixture(autouse=True)
async def _no_leaked_connections() -> AsyncIterator[None]:
    """Make sure a test's agent connections are gone before the next one starts.

    The suite shares one event loop, and an agent connection owns background tasks — a
    presence refresher and a Redis subscriber. A test that returns while those are still
    running leaves them interleaving with the next test's `TRUNCATE`, which surfaces as
    foreign-key violations in fixtures that have nothing to do with sockets. That is not
    a hypothetical: it is how the bug in `AgentConnection.__aexit__` was found.
    """
    yield
    for _ in range(100):
        if gateway.live_connections() == 0:
            break
        await asyncio.sleep(0.02)
    assert gateway.live_connections() == 0, "an agent connection outlived its test"


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    return {"owner": owner, "member": member, "general": channels[0]["id"]}


async def install(owner: Client, **overrides: object) -> dict:
    response = await owner.post("/api/admin/plugins", {**AGENT, **overrides})
    assert response.status == 201, response.body
    return response.body


async def join_channel(owner: Client, app_body: dict, channel_id: str) -> None:
    app_client = owner.fork()
    app_client._http.headers["authorization"] = f"Bearer {app_body['botToken']}"
    app_client._http.cookies.clear()
    joined = await app_client.post("/api/v1/conversations.join", {"channel": channel_id})
    assert joined.status == 200, joined.body


@contextlib.asynccontextmanager
async def agent_socket(token: str | None = None) -> AsyncIterator[Any]:
    """Connect as an agent. With a token, authenticates by header; without, stays mute."""
    headers = {"authorization": f"Bearer {token}"} if token else {}
    async with AsyncClient(
        transport=ASGIWebSocketTransport(app=app), base_url="http://test"
    ) as http:
        async with aconnect_ws("/ws/agent", http, headers=headers) as ws:
            yield ws


def _flatten(error: BaseException) -> list[BaseException]:
    """Every leaf in a possibly-nested exception group."""
    if isinstance(error, BaseExceptionGroup):
        return [leaf for child in error.exceptions for leaf in _flatten(child)]
    return [error]


async def refused_with(token: str) -> int:
    """Connect as an agent that should be turned away, and report the close code.

    The disconnect surfaces while the `async with` unwinds, and anyio wraps it in a task
    group — twice over, since the transport nests one inside another — so this flattens
    rather than asserting that *something* was raised. Asserting the code is the better
    test regardless: 1008 is "policy violation", which a client shows as "the server
    refused me" rather than as a network blip worth retrying immediately.
    """
    try:
        async with agent_socket(token) as ws:
            await receive_until(ws, "ready", timeout=2.0)
    except BaseException as error:
        # Broad, and narrowed immediately: anything that is not our disconnect is
        # re-raised untouched below.
        disconnects = [e for e in _flatten(error) if isinstance(e, WebSocketDisconnect)]
        if not disconnects:
            raise
        return int(disconnects[0].code)
    raise AssertionError("the socket was not refused")


async def receive_until(ws: Any, kind: str, timeout: float = 5.0) -> dict:
    async def _read() -> dict:
        while True:
            frame = json.loads(await ws.receive_text())
            if frame.get("t") == kind:
                return frame

    return await asyncio.wait_for(_read(), timeout=timeout)


async def messages_in(channel_id: str) -> list[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT body FROM messages WHERE channel_id = :c ORDER BY id ASC"),
                {"c": channel_id},
            )
        ).fetchall()
    return [row.body for row in rows]


def agui_event(**event: Any) -> dict[str, Any]:
    return event


ANSWER = (
    agui_event(type="RUN_STARTED", threadId="t", runId="r"),
    agui_event(type="TEXT_MESSAGE_START", messageId="m1"),
    agui_event(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="Standup is at nine."),
    agui_event(type="TEXT_MESSAGE_END", messageId="m1"),
    agui_event(type="RUN_FINISHED", threadId="t", runId="r"),
)


# ─── registering one ──────────────────────────────────────────────────────────
class TestRegistration:
    async def test_a_socket_agent_needs_no_url(self, team: dict) -> None:
        body = await install(team["owner"])
        assert body["plugin"]["runtime"] == "socket"
        assert body["plugin"]["requestUrl"] is None
        assert body["plugin"]["aguiUrl"] is None
        # The token is the whole of the registration: it is what the agent dials in with.
        assert body["botToken"]

    async def test_declaring_a_url_is_refused(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/plugins", {**AGENT, "aguiUrl": "https://apps.example.com/agui"}
        )
        # Two answers to "where is it" is worse than one, and the agent is authoritative.
        assert response.status == 400
        assert response.body["error"]["code"] == "url_not_allowed"


# ─── authenticating ───────────────────────────────────────────────────────────
class TestAuth:
    async def test_the_bot_token_in_a_header_is_accepted(self, team: dict) -> None:
        body = await install(team["owner"])
        async with agent_socket(body["botToken"]) as ws:
            ready = await receive_until(ws, "ready")
            assert ready["pluginId"] == body["plugin"]["id"]
            assert "messages:write" in ready["scopes"]

    async def test_a_first_frame_works_for_a_client_that_cannot_set_headers(
        self, team: dict
    ) -> None:
        body = await install(team["owner"])
        async with agent_socket() as ws:
            await ws.send_text(json.dumps({"t": "auth", "token": body["botToken"]}))
            ready = await receive_until(ws, "ready")
            assert ready["pluginId"] == body["plugin"]["id"]

    async def test_a_bad_token_is_refused(self, team: dict) -> None:
        await install(team["owner"])
        assert await refused_with("blob-bot-nonsense") == 1008

    async def test_a_disabled_agent_cannot_hold_a_connection(self, team: dict) -> None:
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]
        assert (
            await team["owner"].post(
                f"/api/admin/plugins/{plugin_id}/enabled", {"enabled": False}
            )
        ).status == 200

        # Which of "unknown", "revoked" and "disabled" it was is not the caller's
        # business, exactly as on the HTTP path — so it is the same close code.
        assert await refused_with(body["botToken"]) == 1008


# ─── announcing itself, which is the import ───────────────────────────────────
class TestHello:
    async def test_connecting_is_how_an_agent_says_what_it_is(self, team: dict) -> None:
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]

        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")
            await ws.send_text(
                json.dumps(
                    {
                        "t": "hello",
                        "name": "Desktop Claude",
                        "description": "Runs on my laptop.",
                        "version": "2.1.0",
                    }
                )
            )
            await receive_until(ws, "hello_ok")

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in listed if p["id"] == plugin_id)
        assert agent["name"] == "Desktop Claude"
        assert agent["description"] == "Runs on my laptop."
        assert agent["version"] == "2.1.0"

    async def test_an_agent_cannot_grant_itself_a_scope(self, team: dict) -> None:
        """The consent screen has to mean something.

        `hello` carries what the agent *is*, never what it may *do*. An agent that could
        widen its own grants by asserting them on connect would make approval decorative.
        """
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]

        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")
            await ws.send_text(
                json.dumps({"t": "hello", "name": "Greedy", "scopes": ["admin:write"]})
            )
            await receive_until(ws, "hello_ok")

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in listed if p["id"] == plugin_id)
        assert "admin:write" not in agent["scopes"]

    async def test_a_field_left_out_keeps_what_was_there(self, team: dict) -> None:
        body = await install(team["owner"], description="Set by an admin.")
        plugin_id = body["plugin"]["id"]

        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")
            await ws.send_text(json.dumps({"t": "hello", "name": "Renamed"}))
            await receive_until(ws, "hello_ok")

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in listed if p["id"] == plugin_id)
        assert agent["name"] == "Renamed"
        assert agent["description"] == "Set by an admin."


# ─── liveness ─────────────────────────────────────────────────────────────────
class TestPresence:
    async def test_online_only_while_the_socket_is_held(self, team: dict) -> None:
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]

        assert await gateway.is_online(plugin_id) is False
        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")
            assert await gateway.is_online(plugin_id) is True

        # Liveness lives in Redis and not in a column precisely so that leaving clears
        # it. A row saying "connected" would outlive the process that wrote it.
        for _ in range(50):
            if not await gateway.is_online(plugin_id):
                break
            await asyncio.sleep(0.05)
        assert await gateway.is_online(plugin_id) is False


# ─── the run, across processes ────────────────────────────────────────────────
class TestRunRouting:
    async def test_a_mention_reaches_the_agent_and_its_answer_lands(self, team: dict) -> None:
        body = await install(team["owner"])
        await join_channel(team["owner"], body, team["general"])

        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")

            sent = await send_message(team["owner"], team["general"], "@Desktop when is standup?")
            message_id = sent.body["message"]["id"]

            # The job is the worker's side; the socket above is the API process's. What
            # is being tested is that these two find each other through Redis.
            job = asyncio.create_task(agui_job.handle_agui_run(message_id))

            run = await receive_until(ws, "run")
            assert run["input"]["messages"]
            for event in ANSWER:
                await ws.send_text(
                    json.dumps({"t": "event", "runId": run["runId"], "event": event})
                )
            await ws.send_text(json.dumps({"t": "done", "runId": run["runId"]}))
            await asyncio.wait_for(job, timeout=10.0)

        assert "Standup is at nine." in await messages_in(team["general"])

    async def test_an_agent_that_is_not_connected_says_so(self, team: dict) -> None:
        body = await install(team["owner"])
        await join_channel(team["owner"], body, team["general"])

        sent = await send_message(team["owner"], team["general"], "@Desktop are you there?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        bodies = await messages_in(team["general"])
        # It degrades to an apology in the channel rather than to silence: the person
        # asked something and is owed an answer, even if the answer is "not right now".
        assert any("not connected" in body for body in bodies)

    async def test_a_run_reaching_two_holders_is_answered_once(self, team: dict) -> None:
        """Pub/sub is fan-out, and an agent can be connected twice mid-reconnect.

        Without the claim both holders write the run to their socket, both agents answer,
        and the person sees the reply twice. The claim is the same `SET NX` the mention
        job already takes on a message.
        """
        body = await install(team["owner"])
        run_id = "11111111-2222-3333-4444-555555555555"
        plugin_id = body["plugin"]["id"]

        delivered: list[str] = []

        async def holder(name: str) -> None:
            async def send(payload: dict) -> None:
                delivered.append(name)

            async with gateway.AgentConnection(plugin_id, send):
                await asyncio.sleep(1.0)

        first = asyncio.create_task(holder("a"))
        second = asyncio.create_task(holder("b"))
        await asyncio.sleep(0.3)  # Both subscribed.

        from blob_api.lib.redis import redis

        await redis.publish(
            gateway.run_channel(plugin_id),
            json.dumps({"runId": run_id, "input": {"messages": []}}),
        )
        await asyncio.gather(first, second)

        assert len(delivered) == 1


class TestStreamEvents:
    async def test_subscribing_happens_before_publishing(self, team: dict) -> None:
        """The race that makes a working agent look like a hanging one.

        An agent can answer in single-digit milliseconds. Publish the run first and its
        first events go to a channel nobody is listening on yet — the run then appears to
        hang until it times out, having actually succeeded.
        """
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]

        async def instant_agent(payload: dict) -> None:
            # Answers inside the publish call itself, which is the worst case the
            # subscribe-first ordering exists to survive.
            await gateway.relay_event(
                payload["runId"], {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": "hi"}
            )
            await gateway.relay_end(payload["runId"])

        async with gateway.AgentConnection(plugin_id, instant_agent):
            await asyncio.sleep(0.2)
            seen = [
                event
                async for event in gateway.stream_events(
                    plugin_id, {"messages": []}, timeout_sec=5.0
                )
            ]

        assert [e["type"] for e in seen] == ["TEXT_MESSAGE_CONTENT"]
