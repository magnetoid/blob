"""Feedback tickets: anyone files, only admins read.

The asymmetry is the point. A ticket carries a snapshot of whatever the reporter had on
screen, which may include a private channel, so reading one is an admin act even though
writing one is not.
"""

from __future__ import annotations

import asyncio

import pytest

from blob_api.lib import storage

from .helpers import Client, invite_and_sign_up, sign_up

SNAPSHOT = "<!doctype html><html><body><h1>the page they were on</h1></body></html>"


async def _storage_is_up() -> bool:
    """Snapshots need a bucket. Everything else about a ticket does not.

    Filing a ticket deliberately survives storage being down, so most of this file runs
    without it; the tests that are actually about the snapshot say so and skip.
    """
    try:
        await storage.ensure_bucket()
        await storage.put_object("selftest/probe.txt", b"ok", "text/plain")
        return True
    except Exception:
        return False


needs_storage = pytest.mark.skipif(
    not asyncio.run(_storage_is_up()),
    reason="object storage is not running; start it with docker compose up -d minio",
)


def _ticket(**overrides: object) -> dict:
    payload = {
        "kind": "bug",
        "title": "Sending a message spins forever",
        "body": "Pressed enter in #general and the spinner never stopped.",
        "environment": {"url": "/", "viewport": "1440x900"},
        "consoleLog": "2026-08-21T02:00:00.000Z [error] WebSocket closed",
        "snapshot": SNAPSHOT,
    }
    payload.update(overrides)
    return payload


async def test_a_member_files_a_ticket_and_an_admin_reads_it(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")

    created = await member.post("/api/feedback", _ticket())
    assert created.status == 201
    ticket = created.body["ticket"]
    assert ticket["kind"] == "bug"
    assert ticket["status"] == "open"
    # Not asserting hasSnapshot here on purpose: filing a ticket is designed to succeed
    # whether or not storage is reachable, and the snapshot has its own tests.
    assert "WebSocket closed" in ticket["consoleLog"]
    assert ticket["environment"]["viewport"] == "1440x900"

    listed = await owner.get("/api/admin/feedback")
    assert listed.status == 200
    assert [t["id"] for t in listed.body["tickets"]] == [ticket["id"]]


async def test_a_member_cannot_read_the_tickets(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    await member.post("/api/feedback", _ticket())

    # 403 rather than 401: the client treats 401 as "signed out" and would bounce them
    # to the login screen for what is really a permission answer.
    denied = await member.get("/api/admin/feedback")
    assert denied.status == 403


@needs_storage
async def test_the_snapshot_is_served_back_for_an_admin(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    ticket = (await owner.post("/api/feedback", _ticket())).body["ticket"]

    response = await owner.get(f"/api/admin/feedback/{ticket['id']}/snapshot")
    assert response.status == 200
    assert "the page they were on" in response.body
    # Captured from someone else's browser, so it is served under a policy that lets it
    # render and nothing else.
    assert "default-src 'none'" in response.headers["content-security-policy"]


async def test_a_ticket_without_a_snapshot_says_so(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    ticket = (await owner.post("/api/feedback", _ticket(snapshot=""))).body["ticket"]

    assert ticket["hasSnapshot"] is False
    missing = await owner.get(f"/api/admin/feedback/{ticket['id']}/snapshot")
    assert missing.status == 404


async def test_closing_a_ticket_records_who_and_when(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    ticket = (await owner.post("/api/feedback", _ticket())).body["ticket"]

    closed = await owner.patch(f"/api/admin/feedback/{ticket['id']}", {"status": "closed"})
    assert closed.status == 200
    assert closed.body["ticket"]["status"] == "closed"
    assert closed.body["ticket"]["resolvedAt"] is not None
    assert closed.body["ticket"]["resolvedBy"] == owner.user_id

    assert (await owner.get("/api/admin/feedback?status=open")).body["tickets"] == []
    assert len((await owner.get("/api/admin/feedback?status=closed")).body["tickets"]) == 1

    # Reopening clears the resolution rather than leaving a stale one behind.
    reopened = await owner.patch(f"/api/admin/feedback/{ticket['id']}", {"status": "open"})
    assert reopened.body["ticket"]["resolvedAt"] is None
    assert reopened.body["ticket"]["resolvedBy"] is None


async def test_closing_a_ticket_is_audited(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    ticket = (await owner.post("/api/feedback", _ticket())).body["ticket"]
    await owner.patch(f"/api/admin/feedback/{ticket['id']}", {"status": "closed"})

    events = (await owner.get("/api/admin/audit")).body["events"]
    assert any(event["action"] == "feedback.status_changed" for event in events)


@needs_storage
async def test_deleting_a_ticket_takes_its_snapshot_with_it(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    workspace_id = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
    ticket = (await owner.post("/api/feedback", _ticket())).body["ticket"]

    key = f"{workspace_id}/feedback/{ticket['id']}.html"
    assert await storage.get_object(key)

    assert (await owner.delete(f"/api/admin/feedback/{ticket['id']}")).status == 200
    assert (await owner.get("/api/admin/feedback?status=open")).body["tickets"] == []

    # The object goes too; a snapshot outliving its ticket is data nobody can reach.
    with pytest.raises(Exception, match=r"NoSuchKey|404|Not Found"):
        await storage.get_object(key)


async def test_a_bad_kind_is_refused(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    refused = await owner.post("/api/feedback", _ticket(kind="complaint"))
    assert refused.status == 400
    assert refused.body["error"]["code"] == "invalid_input"
