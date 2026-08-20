"""Delivering to an app, against a real socket.

The signature covers the raw request body, so the only honest way to test it is to read
the bytes off a connection and verify them the way a receiving app would. A recording
server rather than a mocked client, for the same reason the rest of the suite runs
against real Postgres: what is being tested is the wire, and a mock of the wire only
proves the mock works.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id
from blob_api.plugins import delivery, signing

from .helpers import Client, sign_up

SECRET = "test-signing-secret"


@dataclass(slots=True)
class Received:
    headers: dict[str, str]
    body: bytes


@dataclass(slots=True)
class RecordingApp:
    """The smallest thing that can be POSTed to. Answers with whatever it is told to."""

    port: int = 0
    status: int = 200
    requests: list[Received] = field(default_factory=list)
    #: Statuses to answer in order; the last one repeats.
    script: list[int] = field(default_factory=list)

    def next_status(self) -> int:
        if not self.script:
            return self.status
        return self.script.pop(0) if len(self.script) > 1 else self.script[0]


@pytest_asyncio.fixture
async def app_server() -> AsyncIterator[RecordingApp]:
    recorder = RecordingApp()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            headers = {}
            for line in lines[1:]:
                if ": " in line:
                    name, _, value = line.partition(": ")
                    headers[name.lower()] = value
            length = int(headers.get("content-length", "0"))
            body = await reader.readexactly(length) if length else b""
            recorder.requests.append(Received(headers=headers, body=body))

            status = recorder.next_status()
            writer.write(f"HTTP/1.1 {status} X\r\ncontent-length: 0\r\n\r\n".encode())
            await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    recorder.port = server.sockets[0].getsockname()[1]
    async with server:
        await server.start_serving()
        yield recorder


async def make_plugin(workspace_id: str, port: int, events: list[str] | None = None) -> str:
    """Insert an app pointed at the recording server.

    Written directly rather than through the install endpoint because the SSRF guard
    correctly refuses a loopback URL — that guard is registration's job, and it is tested
    where it belongs.
    """
    plugin_id = new_id()
    async with SessionFactory() as session:
        await session.execute(
            text(
                """
                INSERT INTO plugins
                  (id, workspace_id, slug, name, runtime, status, request_url, events)
                VALUES (:id, :ws, 'recorder', 'Recorder', 'external', 'enabled', :url,
                        cast(:events AS text[]))
                """
            ),
            {
                "id": plugin_id,
                "ws": workspace_id,
                "url": f"http://127.0.0.1:{port}/events",
                "events": events or ["message.created"],
            },
        )
        await session.execute(
            text("INSERT INTO plugin_secrets (plugin_id, signing_secret) VALUES (:id, :s)"),
            {"id": plugin_id, "s": SECRET},
        )
        await session.commit()
    return plugin_id


async def queue(plugin_id: str, event: str = "message.created", **payload: object) -> str:
    delivery_id = new_id()
    async with SessionFactory() as session:
        await session.execute(
            text(
                """
                INSERT INTO plugin_deliveries (id, plugin_id, event, payload)
                VALUES (:id, :pid, :event, cast(:payload AS jsonb))
                """
            ),
            {
                "id": delivery_id,
                "pid": plugin_id,
                "event": event,
                "payload": json.dumps({"event": event, "payload": payload}),
            },
        )
        await session.commit()
    return delivery_id


async def row(delivery_id: str) -> object:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text(
                    """
                    SELECT status, attempts, last_status_code, last_error, delivered_at,
                           next_attempt_at > now() AS deferred
                      FROM plugin_deliveries WHERE id = :id
                    """
                ),
                {"id": delivery_id},
            )
        ).fetchone()


@pytest_asyncio.fixture
async def workspace(client: Client) -> str:
    owner = await sign_up(client, "Owner")
    return (await owner.get("/api/bootstrap")).body["workspace"]["id"]


# ─── the signature on the wire ────────────────────────────────────────────────
async def test_a_delivery_arrives_signed(workspace: str, app_server: RecordingApp) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    await queue(plugin_id, id="m1")

    assert await delivery.drain_once() == 1
    assert len(app_server.requests) == 1
    request = app_server.requests[0]

    # Verified exactly as a receiving app would: over the raw bytes, with the timestamp
    # from the header, against the shared secret.
    assert signing.verify(
        SECRET,
        request.headers[signing.TIMESTAMP_HEADER],
        request.headers[signing.SIGNATURE_HEADER],
        request.body,
    )
    assert request.headers[signing.SIGNATURE_HEADER].startswith("v0=")
    assert json.loads(request.body)["event"] == "message.created"


async def test_a_delivery_carries_an_id_apps_can_dedupe_on(
    workspace: str, app_server: RecordingApp
) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)
    await delivery.drain_once()
    assert app_server.requests[0].headers["x-blob-delivery-id"] == delivery_id


async def test_the_wrong_secret_does_not_verify_what_we_sent(
    workspace: str, app_server: RecordingApp
) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    await queue(plugin_id)
    await delivery.drain_once()
    request = app_server.requests[0]
    assert not signing.verify(
        "not-the-secret",
        request.headers[signing.TIMESTAMP_HEADER],
        request.headers[signing.SIGNATURE_HEADER],
        request.body,
    )


# ─── what happens to the row ──────────────────────────────────────────────────
async def test_a_success_is_recorded(workspace: str, app_server: RecordingApp) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)
    await delivery.drain_once()

    stored = await row(delivery_id)
    assert stored.status == "delivered"
    assert stored.attempts == 1
    assert stored.last_status_code == 200
    assert stored.delivered_at is not None


async def test_a_delivered_event_is_not_sent_twice(
    workspace: str, app_server: RecordingApp
) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    await queue(plugin_id)
    await delivery.drain_once()
    await delivery.drain_once()
    assert len(app_server.requests) == 1


async def test_a_failure_backs_off_rather_than_hammering(
    workspace: str, app_server: RecordingApp
) -> None:
    app_server.status = 500
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)

    await delivery.drain_once()
    stored = await row(delivery_id)
    assert stored.status == "pending"
    assert stored.attempts == 1
    assert stored.last_status_code == 500
    # Deferred, so the very next drain does not immediately try again.
    assert stored.deferred is True

    await delivery.drain_once()
    assert len(app_server.requests) == 1


async def test_410_stops_permanently(workspace: str, app_server: RecordingApp) -> None:
    # The one status that means "stop sending" — an uninstalled app should be able to
    # say so once instead of refusing two hundred deliveries.
    app_server.status = 410
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)

    await delivery.drain_once()
    stored = await row(delivery_id)
    assert stored.status == "dead"
    assert stored.last_status_code == 410

    await delivery.drain_once()
    assert len(app_server.requests) == 1


async def test_an_unreachable_app_is_recorded_not_raised(workspace: str) -> None:
    # Nothing is listening on this port. A dead app must not take the drain down.
    plugin_id = await make_plugin(workspace, 9)
    delivery_id = await queue(plugin_id)

    assert await delivery.drain_once() == 1
    stored = await row(delivery_id)
    assert stored.status == "pending"
    assert stored.last_status_code is None
    assert stored.last_error


async def test_a_disabled_app_keeps_its_queue_instead_of_burning_it(
    workspace: str, app_server: RecordingApp
) -> None:
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)
    async with SessionFactory() as session:
        await session.execute(
            text("UPDATE plugins SET status = 'disabled' WHERE id = :id"), {"id": plugin_id}
        )
        await session.commit()

    assert await delivery.drain_once() == 0
    stored = await row(delivery_id)
    assert stored.status == "pending"
    # Untouched: re-enabling resumes rather than starting from four failed attempts.
    assert stored.attempts == 0
    assert not app_server.requests

    async with SessionFactory() as session:
        await session.execute(
            text("UPDATE plugins SET status = 'enabled' WHERE id = :id"), {"id": plugin_id}
        )
        await session.commit()
    assert await delivery.drain_once() == 1


async def test_events_reach_one_app_in_the_order_they_happened(
    workspace: str, app_server: RecordingApp
) -> None:
    plugin_id = await make_plugin(
        workspace, app_server.port, events=["message.created", "message.deleted"]
    )
    first = await queue(plugin_id, "message.created", id="m1")
    second = await queue(plugin_id, "message.deleted", id="m1")
    assert first < second  # ids are time-ordered, which is what the drain sorts on

    await delivery.drain_once()
    seen = [json.loads(r.body)["event"] for r in app_server.requests]
    assert seen == ["message.created", "message.deleted"]


async def test_a_leased_delivery_is_not_picked_up_twice(
    workspace: str, app_server: RecordingApp
) -> None:
    """Two workers draining at once must not both deliver the same event."""
    plugin_id = await make_plugin(workspace, app_server.port)
    await queue(plugin_id)

    counts = await asyncio.gather(delivery.drain_once(), delivery.drain_once())
    assert sorted(counts) == [0, 1]
    assert len(app_server.requests) == 1


@pytest.mark.parametrize("status", [200, 201, 202, 204])
async def test_any_2xx_counts_as_delivered(
    workspace: str, app_server: RecordingApp, status: int
) -> None:
    app_server.status = status
    plugin_id = await make_plugin(workspace, app_server.port)
    delivery_id = await queue(plugin_id)
    await delivery.drain_once()
    assert (await row(delivery_id)).status == "delivered"
