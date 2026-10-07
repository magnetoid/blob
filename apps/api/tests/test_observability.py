"""What an operator can see of agents (agentic plan, phase 7).

Four things, each pinned here: what a run streamed, kept a week behind the admin's
drill-in and only where they can see the room; an app's last ten errors rather than its
last one; `/metrics`, counters every process shares through Redis plus two live gauges,
behind a token; and traces — a span per run and per tool call, the run's `traceparent`
sent to the agent, and an MCP request continuing the assistant's own trace from
`params._meta`. With no OTLP endpoint configured, none of the tracing touches the wire.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import agui as agui_job
from blob_api.jobs import agui_outcome
from blob_api.lib import metrics, telemetry
from blob_api.lib.redis import redis
from blob_api.plugins import gateway, run_trail, streams
from blob_api.services import agent_chains
from blob_api.services import agent_runs as agent_run_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_agent_tools import calls, says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
)
from .test_mcp import MODERN, Mcp, mint

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT_SPAN = "00f067aa0ba902b7"


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`."""


@pytest_asyncio.fixture
async def desk(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A workspace with an AG-UI agent in #general answering from scripts — every request
    it was sent kept — and a private room the agent's admin is not in."""
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    app_body = await install(owner)
    await join_channel(owner, app_body, general)

    state: dict[str, Any] = {"scripts": [], "seen": []}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        state["seen"].append(request)
        body = state["scripts"].pop(0) if state["scripts"] else says("(no more scripts)")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        if isinstance(kwargs.get("transport"), httpx.ASGITransport):
            return real(**kwargs)
        kwargs.pop("transport", None)
        return real(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    def record(job: str, *args: Any) -> Any:
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agent_chains, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)
    return {
        "owner": owner,
        "member": member,
        "general": general,
        "app": app_body,
        "plugin_id": app_body["plugin"]["id"],
        "slug": app_body["plugin"]["slug"],
        "state": state,
    }


async def ask(desk: dict[str, Any], body: str, *scripts: bytes) -> str:
    desk["state"]["scripts"] = list(scripts)
    sent = await send_message(desk["owner"], desk["general"], body)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


async def run_of(trigger_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT * FROM agent_runs WHERE trigger_message_id = :id"),
                {"id": trigger_id},
            )
        ).one()


async def app_of(desk: dict[str, Any]) -> dict[str, Any]:
    """The agent as the console lists it."""
    listed = await desk["owner"].get("/api/admin/plugins")
    assert listed.status == 200, listed.body
    (plugin,) = [p for p in listed.body["plugins"] if p["id"] == desk["plugin_id"]]
    return dict(plugin)


# ─── what a run streamed ───────────────────────────────────────────────────────


class TestTheTrailCutsWhatItKeeps:
    def test_a_long_string_keeps_its_start_and_says_how_much_went(self) -> None:
        kept = run_trail.clip(
            {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": "x" * 1000},
            show_reasoning=False,
        )
        assert kept["delta"].startswith("x" * run_trail.MAX_STRING_CHARS)
        assert kept["delta"].endswith("(700 more characters)")
        assert kept["messageId"] == "m"

    def test_reasoning_keeps_its_shape_and_loses_its_words(self) -> None:
        event = {"type": "REASONING_MESSAGE_CONTENT", "messageId": "r", "delta": "my secret plan"}
        hidden = run_trail.clip(event, show_reasoning=False)
        assert "delta" not in hidden
        assert hidden["messageId"] == "r"
        assert "reasoning" in hidden["omitted"]
        # The same rule the card follows: an agent whose row shows reasoning shows it here.
        assert run_trail.clip(event, show_reasoning=True)["delta"] == "my secret plan"
        assert "title" not in run_trail.clip(
            {"type": "THINKING_START", "title": "weighing the options"}, show_reasoning=False
        )

    def test_a_file_piece_keeps_its_size_and_never_its_bytes(self) -> None:
        kept = run_trail.clip(
            {"type": "CUSTOM", "name": "blob.file.chunk", "value": {"id": "f", "data": "QUJD" * 9}},
            show_reasoning=False,
        )
        assert kept["value"] == {"id": "f", "data": "(36 characters of base64)"}

    def test_an_event_still_too_big_is_kept_as_its_type_and_keys(self) -> None:
        state = {f"key{i}": "v" * 200 for i in range(40)}
        kept = run_trail.clip({"type": "STATE_SNAPSHOT", "snapshot": state}, show_reasoning=False)
        assert kept == {
            "type": "STATE_SNAPSHOT",
            "omitted": "too large to keep",
            "keys": ["snapshot", "type"],
        }

    def test_an_event_that_cannot_be_cut_is_logged_as_such_and_the_run_goes_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def broken(*_args: Any, **_kwargs: Any) -> Any:
            raise ValueError("an event nobody anticipated")

        monkeypatch.setattr(run_trail, "clip", broken)
        trail = run_trail.Trail(show_reasoning=False)
        trail.add({"type": "CUSTOM", "name": "x"})
        stored = trail.stored()
        assert stored is not None
        assert stored["kept"][0]["event"] == {"type": "CUSTOM", "omitted": "could not be kept"}

    def test_the_newest_events_are_kept_and_all_of_them_counted(self) -> None:
        trail = run_trail.Trail(show_reasoning=False)
        for n in range(run_trail.MAX_EVENTS + 50):
            trail.add({"type": "STEP_STARTED", "stepName": f"s{n}"})
        stored = trail.stored()
        assert stored is not None
        assert stored["total"] == run_trail.MAX_EVENTS + 50
        assert len(stored["kept"]) == run_trail.MAX_EVENTS
        assert stored["kept"][0]["event"]["stepName"] == "s50"
        assert run_trail.Trail(show_reasoning=False).stored() is None


class TestARunKeepsWhatItStreamed:
    async def test_an_admin_reads_the_events_of_a_run_in_a_room_they_see(
        self, desk: dict[str, Any]
    ) -> None:
        trigger = await ask(desk, "@Helper hello", says("Hi there."))
        run = await run_of(trigger)
        answer = await desk["owner"].get(
            f"/api/admin/plugins/{desk['plugin_id']}/runs/{run.id}/events"
        )
        assert answer.status == 200, answer.body
        assert answer.body["hidden"] is False
        assert answer.body["total"] == 5
        assert [e["event"]["type"] for e in answer.body["events"]] == [
            "RUN_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "RUN_FINISHED",
        ]
        assert answer.body["events"][2]["event"]["delta"] == "Hi there."
        assert answer.body["keptUntil"]

    async def test_every_round_of_a_run_that_used_tools_is_kept_with_its_number(
        self, desk: dict[str, Any]
    ) -> None:
        allowed = await desk["owner"].post(
            f"/api/admin/plugins/{desk['plugin_id']}/tools", {"access": "read"}
        )
        assert allowed.status == 200, allowed.body
        trigger = await ask(
            desk,
            "@Helper what channels are there?",
            calls(("c1", "list_channels", {})),
            says("There is #general."),
        )
        run = await run_of(trigger)
        assert run.status == "succeeded", run.error
        rounds = {entry["round"] for entry in run.events["kept"]}
        assert rounds == {0, 1}

    async def test_a_run_in_a_room_they_are_not_in_keeps_its_events_from_them(
        self, desk: dict[str, Any]
    ) -> None:
        trigger = await ask(desk, "@Helper hello", says("Hi there."))
        run = await run_of(trigger)
        # The room becomes one the admin is not in: private, and they have left it.
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE channels SET kind = 'private' WHERE id = :id"),
                {"id": desk["general"]},
            )
            await session.execute(
                text("DELETE FROM channel_members WHERE channel_id = :c AND user_id = :u"),
                {"c": desk["general"], "u": desk["owner"].user_id},
            )
        answer = await desk["owner"].get(
            f"/api/admin/plugins/{desk['plugin_id']}/runs/{run.id}/events"
        )
        assert answer.status == 200, answer.body
        assert answer.body["hidden"] is True
        assert answer.body["events"] == []
        assert answer.body["total"] == 0

    async def test_a_member_cannot_read_them_at_all(self, desk: dict[str, Any]) -> None:
        trigger = await ask(desk, "@Helper hello", says("Hi there."))
        run = await run_of(trigger)
        answer = await desk["member"].get(
            f"/api/admin/plugins/{desk['plugin_id']}/runs/{run.id}/events"
        )
        assert answer.status == 403, answer.body

    async def test_a_run_that_broke_inside_blob_keeps_what_it_had_streamed(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def broken(*_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("the database went away")

        monkeypatch.setattr(agui_outcome, "_post_round", broken)
        trigger = await ask(desk, "@Helper hello", says("Hi there."))
        run = await run_of(trigger)
        assert run.status == "failed"
        assert run.error == agui_outcome.FAILED_INSIDE_BLOB
        assert run.events["total"] == 5

    async def test_the_events_go_after_a_week_and_the_run_stays(self, desk: dict[str, Any]) -> None:
        trigger = await ask(desk, "@Helper hello", says("Hi there."))
        run = await run_of(trigger)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE agent_runs SET started_at = now() - interval '8 days' WHERE id = :id"),
                {"id": run.id},
            )
        async with transaction() as (session, _after):
            await agent_run_service.sweep(session)
        swept = await run_of(trigger)
        assert swept.events is None
        assert swept.status == "succeeded"


# ─── an app's errors ───────────────────────────────────────────────────────────


class TestAnAppKeepsItsLastTenErrors:
    async def test_the_newest_ten_newest_first_with_the_newest_as_last_error(
        self, desk: dict[str, Any]
    ) -> None:
        for n in range(12):
            await agui_outcome.record_error(desk["plugin_id"], f"failure {n}")
        plugin = await app_of(desk)
        assert plugin["lastError"] == "failure 11"
        async with SessionFactory() as session:
            stored = (
                await session.execute(
                    text("SELECT jsonb_array_length(recent_errors) FROM plugins WHERE id = :id"),
                    {"id": desk["plugin_id"]},
                )
            ).scalar_one()
        assert stored == 10, "the column itself is capped, not only what is read from it"
        assert [e["error"] for e in plugin["recentErrors"]] == [
            f"failure {n}" for n in range(11, 1, -1)
        ]
        assert all(e["at"].endswith("Z") for e in plugin["recentErrors"])

    async def test_switching_it_back_on_clears_the_error_and_keeps_the_history(
        self, desk: dict[str, Any]
    ) -> None:
        await agui_outcome.record_error(desk["plugin_id"], "it fell over")
        switch = f"/api/admin/plugins/{desk['plugin_id']}/enabled"
        assert (await desk["owner"].post(switch, {"enabled": False})).status == 200
        assert (await desk["owner"].post(switch, {"enabled": True})).status == 200
        plugin = await app_of(desk)
        assert plugin["lastError"] is None
        assert [e["error"] for e in plugin["recentErrors"]] == ["it fell over"]

    async def test_a_failed_run_is_one_of_them(self, desk: dict[str, Any]) -> None:
        await ask(
            desk,
            "@Helper hello",
            frame(type="RUN_STARTED", threadId="t", runId="r")
            + frame(type="RUN_ERROR", message="the model is down"),
        )
        plugin = await app_of(desk)
        assert len(plugin["recentErrors"]) == 1
        assert "the model is down" in plugin["recentErrors"][0]["error"]


# ─── /metrics ──────────────────────────────────────────────────────────────────


TOKEN = "scrape-me-0123456789"


async def scrape(client: Client, token: str | None = TOKEN) -> httpx.Response:
    headers = {"authorization": f"Bearer {token}"} if token else {}
    return await client._http.get("/metrics", headers=headers)


def sample(body: str, line_start: str) -> float | None:
    for line in body.splitlines():
        if line.startswith(line_start + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


class TestMetrics:
    async def test_not_there_at_all_until_a_token_is_set(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", None)
        assert (await scrape(desk["owner"])).status_code == 404

    async def test_a_scrape_without_the_token_is_refused(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
        assert (await scrape(desk["owner"], None)).status_code == 401
        refused = await scrape(desk["owner"], "not-the-token")
        assert refused.status_code == 401
        assert refused.headers["www-authenticate"].startswith("Bearer")

    async def test_a_run_is_counted_by_how_it_ended_how_long_and_what_it_spent(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
        spent = b"".join(
            (
                frame(type="RUN_STARTED", threadId="t", runId="r"),
                frame(type="TEXT_MESSAGE_START", messageId="m"),
                frame(type="TEXT_MESSAGE_CONTENT", messageId="m", delta="Done."),
                frame(type="TEXT_MESSAGE_END", messageId="m"),
                frame(
                    type="RUN_FINISHED",
                    threadId="t",
                    runId="r",
                    usage=[{"model": "m1", "inputTokens": 120, "outputTokens": 30}],
                ),
            )
        )
        await ask(desk, "@Helper go", spent)
        answer = await scrape(desk["owner"])
        assert answer.status_code == 200
        assert answer.headers["content-type"].startswith("text/plain; version=0.0.4")
        body = answer.text
        agent = desk["slug"]
        assert sample(body, f'blob_agent_runs_total{{agent="{agent}",status="succeeded"}}') == 1
        assert sample(body, f'blob_agent_run_duration_seconds_count{{agent="{agent}"}}') == 1
        assert (
            sample(body, f'blob_agent_run_duration_seconds_bucket{{agent="{agent}",le="+Inf"}}')
            == 1
        )
        # Every bucket from the first value on: none missing below the one it fell in.
        prefix = "blob_agent_run_duration_seconds_bucket"
        buckets = [line for line in body.splitlines() if line.startswith(prefix)]
        assert len(buckets) == len(metrics.RUN_SECONDS.buckets) + 1
        assert sample(body, f'blob_agent_tokens_total{{agent="{agent}",type="input"}}') == 120
        assert sample(body, f'blob_agent_tokens_total{{agent="{agent}",type="output"}}') == 30
        # The gauges list every agent, at zero when idle, rather than leaving a gap.
        assert sample(body, f'blob_agent_runs_in_flight{{agent="{agent}"}}') == 0
        assert sample(body, f'blob_agent_decisions_waiting{{agent="{agent}"}}') == 0
        assert "# TYPE blob_agent_run_duration_seconds histogram" in body

    async def test_a_run_going_now_is_in_flight(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO agent_runs
                        (id, workspace_id, plugin_id, channel_id, transport, status, chain_id)
                    VALUES (:id, (SELECT workspace_id FROM plugins WHERE id = :p), :p, :c,
                            'http', 'running', :id)
                    """
                ),
                {
                    "id": "01a66666-6666-7666-8666-666666666666",
                    "p": desk["plugin_id"],
                    "c": desk["general"],
                },
            )
        body = (await scrape(desk["owner"])).text
        assert sample(body, f'blob_agent_runs_in_flight{{agent="{desk["slug"]}"}}') == 1

    async def test_a_refused_run_is_counted_too(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
        turned_off = await desk["owner"].patch(
            "/api/admin/settings", {"settings": {"agentsEnabled": False}}
        )
        assert turned_off.status == 200, turned_off.body
        await ask(desk, "@Helper hello")
        refused = f'blob_agent_runs_total{{agent="{desk["slug"]}",status="refused"}}'
        # Counted past the refusal's commit, by a task of its own: wait for it, briefly.
        for _ in range(100):
            body = (await scrape(desk["owner"])).text
            if sample(body, refused) is not None:
                break
            await asyncio.sleep(0.02)
        assert sample(body, refused) == 1

    async def test_blobs_tools_are_counted_by_who_called_them_and_how_it_went(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
        assistant = Mcp(desk["owner"].fork(), await mint(desk["owner"]), era=MODERN)
        await assistant.call("whoami")
        await assistant.refuse("read_channel", {"channel": "#nowhere"})
        allowed = await desk["owner"].post(
            f"/api/admin/plugins/{desk['plugin_id']}/tools", {"access": "read"}
        )
        assert allowed.status == 200, allowed.body
        await ask(desk, "@Helper look", calls(("c1", "list_channels", {})), says("Seen."))
        body = (await scrape(desk["owner"])).text
        assert sample(body, 'blob_tool_calls_total{outcome="ok",tool="whoami",via="mcp"}') == 1
        assert (
            sample(body, 'blob_tool_calls_total{outcome="refused",tool="read_channel",via="mcp"}')
            == 1
        )
        assert (
            sample(body, 'blob_tool_calls_total{outcome="ok",tool="list_channels",via="agent"}')
            == 1
        )

    async def test_a_counter_that_cannot_reach_redis_is_dropped_not_raised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def down(*_args: Any, **_kwargs: Any) -> Any:
            raise ConnectionError("redis is down")

        monkeypatch.setattr(redis, "hincrbyfloat", down)
        monkeypatch.setattr(redis, "pipeline", down)
        await metrics.run_ended("helper", "succeeded", seconds=1.0)
        await metrics.tool_called("mcp", "whoami", "ok")

    async def test_a_scrape_that_cannot_read_the_counters_says_so(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)

        async def down(*_args: Any) -> Any:
            raise ConnectionError("redis is down")

        monkeypatch.setattr(redis, "hgetall", down)
        assert (await scrape(desk["owner"])).status_code == 503

    async def test_a_slow_run_fills_only_the_buckets_it_fits_and_writes_them_all(self) -> None:
        await redis.delete(metrics.KEY)
        await metrics.observe(metrics.RUN_SECONDS, {"agent": "slow"}, 7.0)
        body = await metrics.render({})
        bucket = 'blob_agent_run_duration_seconds_bucket{agent="slow",le="%s"}'
        assert sample(body, bucket % "0.5") == 0
        assert sample(body, bucket % "5") == 0
        assert sample(body, bucket % "10") == 1
        assert sample(body, bucket % "+Inf") == 1
        assert sample(body, 'blob_agent_run_duration_seconds_sum{agent="slow"}') == 7.0
        lines = [line for line in body.splitlines() if line.startswith("blob_agent_run_dur")]
        # In the order the format wants: the buckets by bound, then the sum and the count.
        assert lines[0].endswith('le="0.5"} 0')
        assert lines[-2].startswith("blob_agent_run_duration_seconds_sum")
        assert lines[-1].startswith("blob_agent_run_duration_seconds_count")

    async def test_a_label_value_is_quoted_as_the_format_says(self) -> None:
        await redis.delete(metrics.KEY)
        await metrics.run_ended('say "hi"\\\n', "succeeded")
        body = await metrics.render({})
        assert 'blob_agent_runs_total{agent="say \\"hi\\"\\\\\\n",status="succeeded"} 1' in body


# ─── traces ────────────────────────────────────────────────────────────────────


_EXPORTER = InMemorySpanExporter()
_PROVIDER: list[TracerProvider] = []


def _install_provider() -> None:
    """A recording SDK, into memory. The global provider can be set once per process, so
    the first test to ask sets it and the rest reuse it."""
    if not _PROVIDER:
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(_EXPORTER))
        trace.set_tracer_provider(provider)
        _PROVIDER.append(provider)


@pytest.fixture
def spans(monkeypatch: pytest.MonkeyPatch) -> Iterator[InMemorySpanExporter]:
    """Tracing on: the SDK installed, and `_configured`, which `inject` and `extract`
    read, set — and back to off after every test."""
    _install_provider()
    monkeypatch.setattr(telemetry, "_configured", True)
    _EXPORTER.clear()
    yield _EXPORTER
    _EXPORTER.clear()


def traceparent_of(context: Any) -> str:
    """The header W3C Trace Context writes for a span: its flags as the SDK set them —
    sampled, and since Level 2 also "random" for a trace id the SDK generated."""
    return f"00-{context.trace_id:032x}-{context.span_id:016x}-{int(context.trace_flags):02x}"


def named(exporter: InMemorySpanExporter, name: str) -> list[ReadableSpan]:
    return [span for span in exporter.get_finished_spans() if span.name == name]


class TestTraces:
    async def test_a_run_is_a_span_and_the_agent_is_handed_its_trace(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        await ask(desk, "@Helper hello", says("Hi there."))
        (run_span,) = named(spans, "invoke_agent Helper")
        assert run_span.kind is SpanKind.CLIENT
        attributes = dict(run_span.attributes or {})
        assert attributes["gen_ai.operation.name"] == "invoke_agent"
        assert attributes["gen_ai.agent.id"] == desk["plugin_id"]
        assert attributes["blob.run.status"] == "succeeded"
        assert attributes["server.address"] == "apps.example.com"
        context = run_span.get_span_context()
        assert context is not None
        sent = desk["state"]["seen"][0].headers["traceparent"]
        assert sent == traceparent_of(context)

    async def test_a_tool_call_is_a_child_of_its_run(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        allowed = await desk["owner"].post(
            f"/api/admin/plugins/{desk['plugin_id']}/tools", {"access": "read"}
        )
        assert allowed.status == 200, allowed.body
        await ask(desk, "@Helper look", calls(("c1", "list_channels", {})), says("Seen."))
        (run_span,) = named(spans, "invoke_agent Helper")
        (tool_span,) = named(spans, "execute_tool list_channels")
        assert tool_span.parent is not None
        assert run_span.context is not None
        assert tool_span.parent.span_id == run_span.context.span_id
        attributes = dict(tool_span.attributes or {})
        assert attributes["gen_ai.tool.call.id"] == "c1"
        assert attributes["gen_ai.tool.type"] == "function"
        assert attributes["blob.tool.outcome"] == "ok"
        # Both rounds carried the same parent: the agent's spans hang off the run.
        parents = {request.headers["traceparent"] for request in desk["state"]["seen"]}
        assert len(parents) == 1

    async def test_a_failed_run_is_an_error_by_its_status_not_its_words(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        await ask(
            desk,
            "@Helper hello",
            frame(type="RUN_STARTED", threadId="t", runId="r")
            + frame(type="RUN_ERROR", message="secret details of the failure"),
        )
        (run_span,) = named(spans, "invoke_agent Helper")
        assert run_span.status.status_code is trace.StatusCode.ERROR
        assert run_span.status.description is None
        assert dict(run_span.attributes or {})["error.type"] == "failed"
        assert "secret details" not in json.dumps(dict(run_span.attributes or {}))

    async def test_an_mcp_request_continues_the_assistants_trace(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        assistant = Mcp(desk["owner"].fork(), await mint(desk["owner"]), era=MODERN)
        response = await assistant.send(
            "tools/call",
            {
                "name": "whoami",
                "arguments": {},
                "_meta": {"traceparent": f"00-{TRACE_ID}-{PARENT_SPAN}-01"},
            },
        )
        assert response.status_code == 200, response.text
        (server_span,) = named(spans, "tools/call whoami")
        assert server_span.kind is SpanKind.SERVER
        assert server_span.parent is not None
        assert f"{server_span.parent.trace_id:032x}" == TRACE_ID
        assert f"{server_span.parent.span_id:016x}" == PARENT_SPAN
        attributes = dict(server_span.attributes or {})
        assert attributes["mcp.method.name"] == "tools/call"
        assert attributes["gen_ai.tool.name"] == "whoami"
        assert attributes["mcp.protocol.version"] == MODERN

    async def test_a_trace_context_that_is_not_one_is_ignored(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        assistant = Mcp(desk["owner"].fork(), await mint(desk["owner"]), era=MODERN)
        response = await assistant.send(
            "tools/call", {"name": "whoami", "arguments": {}, "_meta": {"traceparent": 12}}
        )
        assert response.status_code == 200, response.text
        (server_span,) = named(spans, "tools/call whoami")
        assert server_span.parent is None

    async def test_a_method_nobody_knows_does_not_name_a_span(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        assistant = Mcp(desk["owner"].fork(), await mint(desk["owner"]), era=MODERN)
        await assistant.send("made/up-by-the-client-1234")
        (other,) = named(spans, "other")
        attributes = dict(other.attributes or {})
        assert attributes["mcp.method.name"] == "made/up-by-the-client-1234"
        assert attributes["error.type"] == "-32601"

    async def test_a_socket_agent_gets_the_trace_on_its_run_frame(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        body = await desk["owner"].post(
            "/api/admin/plugins",
            {
                "slug": "desktop",
                "name": "Desktop",
                "runtime": "socket",
                "version": "1.0.0",
                "events": [],
                "scopes": ["messages:read", "messages:write"],
            },
        )
        assert body.status == 201, body.body
        plugin_id = body.body["plugin"]["id"]
        frames: list[dict[str, Any]] = []

        async def agent(payload: dict[str, Any]) -> None:
            frames.append(payload)
            if payload.get("t") == "run":
                await gateway.relay_end(payload["runId"])

        async with gateway.AgentConnection(plugin_id, agent):
            await asyncio.sleep(0.2)
            with telemetry.span("invoke_agent Desktop") as run_span:
                async for _event in gateway.stream_events(
                    plugin_id, {"messages": []}, timeout_sec=5.0
                ):
                    pass
        (run,) = [f for f in frames if f.get("t") == "run"]
        context = run_span.get_span_context()
        assert run["traceparent"] == traceparent_of(context)


def no_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """No collector named anywhere — not in the environment and not in a `.env` file."""
    for name in ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("OTEL_SDK_DISABLED", raising=False)
    monkeypatch.setattr(settings, "OTEL_EXPORTER_OTLP_ENDPOINT", None)


class TestTracingOff:
    async def test_with_no_endpoint_the_agent_is_sent_no_trace(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Even with spans recording in this process: what decides is whether tracing was
        # configured, which it never is without an endpoint.
        _install_provider()
        no_endpoint(monkeypatch)
        assert telemetry.enabled() is False
        await ask(desk, "@Helper hello", says("Hi there."))
        assert "traceparent" not in desk["state"]["seen"][0].headers
        _EXPORTER.clear()

    def test_tracing_starts_only_with_an_endpoint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        no_endpoint(monkeypatch)
        assert telemetry.enabled() is False
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
        assert telemetry.enabled() is True
        monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
        assert telemetry.enabled() is False

    def test_an_endpoint_in_the_env_file_counts_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`.env` feeds Blob's settings and not the process environment, which is where
        the SDK reads; the setting is what carries it over."""
        no_endpoint(monkeypatch)
        monkeypatch.setattr(settings, "OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
        assert telemetry.enabled() is True
