"""What an operator can see of the server itself (ADR 0025's addendum): requests counted
and traced by route template, the process gauges, and errors browsers report — each in a
shape that carries no path, no query and nothing anybody wrote.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
import pytest_asyncio
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from blob_api.config import settings
from blob_api.lib import metrics, telemetry
from blob_api.lib.redis import redis

from .helpers import Client, build_client, invite_and_sign_up, send_message, sign_up
from .test_observability import _EXPORTER, _install_provider, sample, scrape

TOKEN = "scrape-me-0123456789"


@pytest.fixture
def spans(monkeypatch: pytest.MonkeyPatch) -> Iterator[InMemorySpanExporter]:
    _install_provider()
    monkeypatch.setattr(telemetry, "_configured", True)
    _EXPORTER.clear()
    yield _EXPORTER
    _EXPORTER.clear()


@pytest_asyncio.fixture
async def desk(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "METRICS_TOKEN", TOKEN)
    # A clean tally: what earlier tests in this process counted is not this test's.
    monkeypatch.setattr(metrics, "tally", metrics.Tally())
    owner = await sign_up(client, "Olga Owner")
    member = await invite_and_sign_up(owner, "Max Member")
    channels = {c["name"]: c["id"] for c in (await owner.get("/api/channels")).body["channels"]}
    return {"owner": owner, "member": member, "general": channels["general"]}


def counted(prefix: str) -> dict[str, float]:
    return {
        field: value for field, value in metrics.tally._pending.items() if field.startswith(prefix)
    }


class TestRequests:
    async def test_a_request_is_counted_by_its_route_template_never_its_path(
        self, desk: dict[str, Any]
    ) -> None:
        sent = await send_message(desk["owner"], desk["general"], "find the route")
        message_id = sent.body["message"]["id"]
        assert (await desk["owner"].get(f"/api/messages/{message_id}/thread")).status == 200

        requests = counted("blob_http_requests_total")
        assert (
            'blob_http_requests_total{method="GET",route="/api/messages/{message_id}/thread",'
            'status="200"}' in requests
        )
        assert not [field for field in metrics.tally._pending if message_id in field]

    async def test_a_path_nothing_matched_is_one_series(self, desk: dict[str, Any]) -> None:
        await desk["owner"].get("/api/no-such-thing/0123")
        await desk["owner"].get("/c/somewhere/in/the/client?q=secret")
        fields = " ".join(counted("blob_http_requests_total"))
        assert 'route="unmatched"' in fields and 'route="web"' in fields
        assert "no-such-thing" not in fields and "secret" not in fields

    async def test_the_tally_reaches_the_scrape(self, desk: dict[str, Any]) -> None:
        await desk["owner"].get("/api/channels")
        await metrics.tally.flush()
        body = (await scrape(desk["owner"], TOKEN)).text
        assert (
            sample(
                body, 'blob_http_requests_total{method="GET",route="/api/channels",status="200"}'
            )
            or 0
        ) >= 1
        assert (
            sample(
                body,
                'blob_http_request_duration_seconds_count{method="GET",route="/api/channels"}',
            )
            or 0
        ) >= 1

    async def test_a_request_is_a_server_span_named_by_its_route(
        self, desk: dict[str, Any], spans: InMemorySpanExporter
    ) -> None:
        caller = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        response = await desk["owner"]._http.get(
            "/api/channels?q=private-words", headers={"traceparent": caller}
        )
        assert response.status_code == 200
        (server,) = [
            span for span in spans.get_finished_spans() if span.name == "GET /api/channels"
        ]
        assert server.kind == SpanKind.SERVER
        assert server.attributes is not None
        assert server.attributes["http.route"] == "/api/channels"
        assert server.attributes["http.response.status_code"] == 200
        assert f"{server.context.trace_id:032x}" == "0af7651916cd43dd8448eb211c80319c"
        assert "private-words" not in str(dict(server.attributes))
        # Nor any other span the request made, under whatever name: FastAPI 0.162 began
        # tracing requests itself, with `url.path` and `url.query` (main.py turns it off).
        for span in spans.get_finished_spans():
            attributes = dict(span.attributes or {})
            assert "private-words" not in str(attributes), span.name
            assert not [key for key in attributes if key.startswith("url.")], span.name


class TestProcessGauges:
    async def test_each_process_reports_and_the_scrape_adds_them_up(
        self, desk: dict[str, Any]
    ) -> None:
        await metrics.report_process("p1", {"websockets": 3, "db_in_use": 2, "db_idle": 5})
        await metrics.report_process("p2", {"websockets": 4, "db_in_use": 1, "db_idle": 1})
        await redis.zadd("arq:queue", {"job-a": 1, "job-b": 2})

        body = (await scrape(desk["owner"], TOKEN)).text

        assert sample(body, "blob_websocket_connections") == 7
        assert sample(body, 'blob_db_pool_connections{state="in_use"}') == 3
        assert sample(body, 'blob_db_pool_connections{state="idle"}') == 6
        assert sample(body, "blob_job_queue_depth") == 2

    async def test_a_process_that_stops_reporting_stops_counting(self) -> None:
        await metrics.report_process("gone", {"websockets": 9})
        assert 0 < await redis.ttl(metrics.PROCESS_KEY + "gone") <= metrics.PROCESS_TTL_SEC


class TestClientErrors:
    async def test_a_report_is_kept_cut_down_and_grouped(self, desk: dict[str, Any]) -> None:
        report = {
            "message": (
                "TypeError: cannot read 'x' at https://chat.example/c/"
                "01a15dd7-39f1-77c3-945a-e7a46ef0d4f0?q=salaries#top for ana@example.com"
            ),
            "stack": "TypeError: x\n    at Ze (https://chat.example/assets/index-Bh.js:1:2)\n"
            "    at sk-live-0123456789abcdefghijklmnopqrstuvwxyz",
            "path": "/c/01a15dd7-39f1-77c3-945a-e7a46ef0d4f0",
            "release": "abc1234",
        }
        for _ in range(2):
            assert (await desk["member"].post("/api/client-errors", report)).status == 200

        listed = await desk["owner"].get("/api/admin/client-errors")
        (fault,) = listed.body["errors"]
        assert fault["count"] == 2
        assert fault["message"] == (
            "TypeError: cannot read 'x' at https://chat.example/c/{id} for [email]"
        )
        assert "salaries" not in str(fault) and "ana@example.com" not in str(fault)
        assert "sk-live-0123456789" not in fault["stack"] and "[redacted]" in fault["stack"]
        assert fault["path"] == "/c/{id}"
        assert fault["release"] == "abc1234"

    async def test_only_the_workspace_s_admins_read_them(
        self, desk: dict[str, Any], client: Client
    ) -> None:
        await desk["member"].post("/api/client-errors", {"message": "boom"})
        assert (await desk["member"].get("/api/admin/client-errors")).status == 403
        assert len((await desk["owner"].get("/api/admin/client-errors")).body["errors"]) == 1

        assert (await desk["owner"].delete("/api/admin/client-errors")).status == 200
        assert (await desk["owner"].get("/api/admin/client-errors")).body["errors"] == []

    async def test_reports_need_a_session_and_are_capped(self, desk: dict[str, Any]) -> None:
        async with build_client() as stranger:
            anonymous = await stranger._http.post("/api/client-errors", json={"message": "x"})
        assert anonymous.status_code in (401, 403)
        statuses = [
            (await desk["member"].post("/api/client-errors", {"message": f"loop {n}"})).status
            for n in range(61)
        ]
        assert statuses[:60] == [200] * 60 and statuses[60] == 429

    async def test_a_workspace_keeps_its_most_recently_seen_faults(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.services import client_errors

        monkeypatch.setattr(client_errors, "KEEP", 3)
        for n in range(5):
            await client_errors.record(
                "ws", message=f"fault {n}", stack=None, path="/", release=None, user_agent=""
            )
        kept = await client_errors.recent("ws")
        assert [fault.message for fault in kept] == ["fault 4", "fault 3", "fault 2"]
