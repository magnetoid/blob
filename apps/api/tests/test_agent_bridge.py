"""The client half of ADR 0012: holding Blob's socket from a laptop.

`tools/agent_bridge.py` is the piece that was missing. Blob has had the server side of
socket agents for a while — an agent with no address dials in and holds a WebSocket — and
there was nothing on the other end of it, so "run your agent on your desktop" was a design
rather than a thing anyone could do.

What is covered here is the part that can be silently wrong. The signature has to match
what the agent verifies with, byte for byte, or every run is refused with a 401 that reads
like the agent being down. And `done` has to be sent on every path, because the server
holds a run open until it is told otherwise — a bridge that fails without saying so costs
the person a full timeout of silence, which is the one outcome worse than an error.
"""

from __future__ import annotations

import json
import time
from typing import Any

import pytest

from blob_api.plugins import signing
from blob_api.tools import agent_bridge

from .test_agui import team  # noqa: F401 — a fixture, used by name


@pytest.fixture
def config(monkeypatch: pytest.MonkeyPatch) -> agent_bridge.Config:
    monkeypatch.setenv("BLOB_URL", "https://chat.example.com")
    monkeypatch.setenv("BLOB_BOT_TOKEN", "blob-bot-abc")
    monkeypatch.setenv("AGENT_AGUI_URL", "http://127.0.0.1:8642/v1/agui")
    monkeypatch.setenv("BLOB_SIGNING_SECRET", "s3cret")
    return agent_bridge.Config()


class Socket:
    """A socket that records what was written to it."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    def frames(self, kind: str) -> list[dict[str, Any]]:
        return [f for f in self.sent if f.get("t") == kind]


class TestWhatItIsPointedAt:
    def test_https_becomes_wss(self, config: agent_bridge.Config) -> None:
        assert config.socket_url == "wss://chat.example.com/ws/agent"

    def test_http_becomes_ws(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BLOB_URL", "http://localhost:3000")
        monkeypatch.setenv("BLOB_BOT_TOKEN", "t")
        monkeypatch.setenv("AGENT_AGUI_URL", "http://127.0.0.1:8642/v1/agui")

        assert agent_bridge.Config().socket_url == "ws://localhost:3000/ws/agent"

    def test_a_missing_setting_fails_at_startup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("BLOB_URL", raising=False)

        # Rather than at the first run, hours later, in a log nobody is watching.
        with pytest.raises(SystemExit):
            agent_bridge.Config()


class TestTheSignature:
    def test_it_matches_what_the_server_produces(self) -> None:
        body = b'{"threadId":"t"}'

        mine = agent_bridge._sign("s3cret", 1755657600, body)
        theirs = signing.sign("s3cret", 1755657600, body)

        # Reimplemented in the bridge so the file can be copied to a laptop and run with
        # nothing but httpx and websockets. That freedom is only safe while this holds,
        # and a drift here is a 401 from the agent that reads like the agent being down.
        assert mine == theirs

    def test_the_server_verifies_it(self) -> None:
        body = b"{}"
        # Now, not a fixed instant: `verify` refuses a timestamp more than MAX_SKEW_SEC
        # from its own clock, which is what stops a captured request being replayed.
        stamp = int(time.time())

        assert signing.verify("s3cret", str(stamp), agent_bridge._sign("s3cret", stamp, body), body)


class TestReadingTheAgentsStream:
    async def test_records_split_across_chunks_are_reassembled(self) -> None:
        # A record routinely straddles a chunk boundary; the decoder holds the partial
        # line until the rest arrives.
        chunks = ['data: {"type": "RUN_ST', 'ARTED"}\n\ndata: {"type": "RUN_FINISHED"}\n\n']
        events = [e async for e in agent_bridge._sse_events(_stream(chunks))]

        assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_FINISHED"]

    async def test_keepalive_comments_are_ignored(self) -> None:
        chunks = [": keep-alive\n\n", 'data: {"type": "RUN_FINISHED"}\n\n']

        events = [e async for e in agent_bridge._sse_events(_stream(chunks))]

        assert [e["type"] for e in events] == ["RUN_FINISHED"]

    async def test_a_final_record_without_a_blank_line_still_arrives(self) -> None:
        events = [e async for e in agent_bridge._sse_events(_stream(['data: {"type": "X"}']))]

        assert [e["type"] for e in events] == ["X"]


class TestRelayingARun:
    async def test_every_event_is_forwarded_under_its_run_id(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _answers_with(monkeypatch, bridge, {"type": "RUN_STARTED"}, {"type": "RUN_FINISHED"})
        socket = Socket()

        await bridge._run(socket, "run-1", {"threadId": "t"})

        assert [f["event"]["type"] for f in socket.frames("event")] == [
            "RUN_STARTED",
            "RUN_FINISHED",
        ]
        assert {f["runId"] for f in socket.frames("event")} == {"run-1"}

    async def test_done_is_sent_last(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _answers_with(monkeypatch, bridge, {"type": "RUN_FINISHED"})
        socket = Socket()

        await bridge._run(socket, "run-1", {})

        assert socket.sent[-1] == {"t": "done", "runId": "run-1"}

    async def test_done_is_sent_even_when_the_agent_fails(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _fails_with(monkeypatch, bridge, RuntimeError("the agent answered 500"))
        socket = Socket()

        await bridge._run(socket, "run-1", {})

        # The server holds a run open until told otherwise. Failing quietly costs the
        # person a full 150-second timeout of nothing at all.
        assert socket.sent[-1] == {"t": "done", "runId": "run-1"}

    async def test_a_failure_before_any_answer_is_reported(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _fails_with(monkeypatch, bridge, RuntimeError("the agent answered 500"))
        socket = Socket()

        await bridge._run(socket, "run-1", {})

        [error] = [f for f in socket.frames("event") if f["event"]["type"] == "RUN_ERROR"]
        assert "500" in error["event"]["message"]

    async def test_a_failure_after_a_real_answer_is_not(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _answers_then_fails(monkeypatch, bridge, {"type": "TEXT_MESSAGE_END"})
        socket = Socket()

        await bridge._run(socket, "run-1", {})

        # Appending an apology under an answer that arrived is how a run that mostly
        # worked reads as broken.
        assert not [f for f in socket.frames("event") if f["event"]["type"] == "RUN_ERROR"]
        assert socket.sent[-1] == {"t": "done", "runId": "run-1"}


class TestKeepingTrackOfRuns:
    async def test_draining_snapshots_before_cancelling(
        self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bridge = agent_bridge.Bridge(config)
        _answers_with(monkeypatch, bridge, {"type": "RUN_FINISHED"})
        socket = Socket()
        for i in range(3):
            bridge._start_run(socket, f"run-{i}", {})

        await bridge._drain_runs()

        # Each task discards itself from the set on completion, so cancelling while
        # iterating the live set skips half of them and the gather awaits only what
        # survived. Blob's own AgentConnection had exactly this bug.
        assert bridge._runs == set()


def _stream(chunks: list[str]) -> Any:
    """Something shaped enough like an httpx.Response for `_sse_events`."""

    class Fake:
        async def aiter_text(self) -> Any:
            for chunk in chunks:
                yield chunk

    return Fake()


def _install(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, gen: Any) -> None:
    monkeypatch.setattr(bridge, "_ask_agent", gen)


def _answers_with(
    monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, *events: dict[str, Any]
) -> None:
    async def fake(_run_input: dict[str, Any]) -> Any:
        for event in events:
            yield event

    _install(monkeypatch, bridge, fake)


def _fails_with(
    monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, error: Exception
) -> None:
    async def fake(_run_input: dict[str, Any]) -> Any:
        raise error
        yield  # pragma: no cover — makes this an async generator

    _install(monkeypatch, bridge, fake)


def _answers_then_fails(
    monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, event: dict[str, Any]
) -> None:
    async def fake(_run_input: dict[str, Any]) -> Any:
        yield event
        raise RuntimeError("the stream died")

    _install(monkeypatch, bridge, fake)


class TestServingTheBridge:
    """The download an admin gets, so a laptop needs two commands rather than a checkout.

    Serving the file is the difference between "install Blob on your desktop to run one
    script" and a link. It is admin-only because it is served alongside the tokens it is
    used with — not because the source is secret; it is in a public repository.
    """

    async def test_an_admin_gets_the_script(self, team: dict) -> None:  # noqa: F811
        response = await team["owner"].get("/api/admin/plugins/bridge")

        assert response.status == 200
        body = response.body if isinstance(response.body, str) else ""
        # The real file, not a placeholder: these are the two things a bridge must do.
        assert "BLOB_BOT_TOKEN" in body
        assert '"t": "done"' in body or '{"t": "done"' in body

    async def test_a_member_does_not(self, team: dict) -> None:  # noqa: F811
        assert (await team["member"].get("/api/admin/plugins/bridge")).status == 403
