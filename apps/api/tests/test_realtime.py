"""WebSocket delivery, presence and typing.

These drive a real socket through the ASGI app, so they exercise the queue-and-writer
split the hub uses: services enqueue synchronously, one task per connection writes.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest_asyncio
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport

from blob_api.main import app
from blob_api.realtime import hub

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "general": general}


@asynccontextmanager
async def socket_for(client: Client) -> AsyncIterator[Any]:
    """Open a WebSocket carrying the client's session cookie."""
    cookies = client._http.cookies
    # ASGIWebSocketTransport speaks the ASGI websocket scope; plain ASGITransport
    # only handles http and would 404 the upgrade.
    async with AsyncClient(
        transport=ASGIWebSocketTransport(app=app), base_url="http://test", cookies=cookies
    ) as http:
        async with aconnect_ws("/ws", http) as ws:
            yield ws


async def receive_until(ws: Any, kind: str, timeout: float = 3.0) -> dict:
    """Read frames until one of `kind` arrives, ignoring the rest."""

    async def _read() -> dict:
        while True:
            frame = json.loads(await ws.receive_text())
            if frame.get("t") == kind:
                return frame

    return await asyncio.wait_for(_read(), timeout=timeout)


async def test_the_socket_greets_and_answers_a_ping(team: dict) -> None:
    async with socket_for(team["owner"]) as ws:
        hello = await receive_until(ws, "hello")
        assert hello["userId"] == team["owner"].user_id

        await ws.send_text(json.dumps({"t": "ping"}))
        assert (await receive_until(ws, "pong"))["t"] == "pong"


async def test_a_message_reaches_another_member_live(team: dict) -> None:
    async with socket_for(team["member"]) as ws:
        await receive_until(ws, "hello")

        await send_message(team["owner"], team["general"]["id"], "live delivery")

        event = await receive_until(ws, "message.new")
        assert event["message"]["body"] == "live delivery"
        assert event["message"]["channelId"] == team["general"]["id"]


async def test_an_edit_and_a_delete_reach_subscribers(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "before")
    message_id = sent.body["message"]["id"]

    async with socket_for(team["member"]) as ws:
        await receive_until(ws, "hello")

        await team["owner"].patch(f"/api/messages/{message_id}", {"body": "after"})
        updated = await receive_until(ws, "message.updated")
        assert updated["message"]["body"] == "after"

        await team["owner"].delete(f"/api/messages/{message_id}")
        deleted = await receive_until(ws, "message.deleted")
        assert deleted["id"] == message_id


async def test_a_reaction_reaches_subscribers(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "react")
    message_id = sent.body["message"]["id"]

    async with socket_for(team["member"]) as ws:
        await receive_until(ws, "hello")
        await team["owner"].put(f"/api/messages/{message_id}/reactions", {"emoji": ":tada:"})

        event = await receive_until(ws, "reaction.added")
        assert event["emoji"] == ":tada:"
        assert event["userId"] == team["owner"].user_id


async def test_a_thread_reply_updates_the_summary_line(team: dict) -> None:
    root = await send_message(team["owner"], team["general"]["id"], "root")
    root_id = root.body["message"]["id"]

    async with socket_for(team["member"]) as ws:
        await receive_until(ws, "hello")
        await send_message(team["owner"], team["general"]["id"], "reply", threadRootId=root_id)

        event = await receive_until(ws, "thread.updated")
        assert event["rootId"] == root_id
        assert event["replyCount"] == 1


async def test_presence_is_only_pushed_to_subscribers(team: dict) -> None:
    async with socket_for(team["owner"]) as ws:
        await receive_until(ws, "hello")

        # Ask about the member specifically; the reply covers their current state.
        await ws.send_text(json.dumps({"t": "presence.sub", "userIds": [team["member"].user_id]}))
        event = await receive_until(ws, "presence")
        assert event["userId"] == team["member"].user_id
        assert event["state"] in ("active", "away", "offline")


async def test_typing_reaches_the_channel(team: dict) -> None:
    async with socket_for(team["member"]) as ws_member:
        await receive_until(ws_member, "hello")

        async with socket_for(team["owner"]) as ws_owner:
            await receive_until(ws_owner, "hello")
            await ws_owner.send_text(
                json.dumps({"t": "typing", "channelId": team["general"]["id"]})
            )

            event = await receive_until(ws_member, "typing")
            assert event["userId"] == team["owner"].user_id
            assert event["channelId"] == team["general"]["id"]


async def test_a_private_channel_message_never_reaches_a_non_member(team: dict) -> None:
    secret = (
        await team["owner"].post("/api/channels", {"name": "quiet-room", "kind": "private"})
    ).body["channel"]

    async with socket_for(team["member"]) as ws:
        await receive_until(ws, "hello")
        await send_message(team["owner"], secret["id"], "not for you")

        # A message the member can see should arrive; the private one should not.
        await send_message(team["owner"], team["general"]["id"], "for everyone")
        event = await receive_until(ws, "message.new")
        assert event["message"]["body"] == "for everyone"


def test_presence_subscriptions_leave_nothing_behind() -> None:
    """The reverse presence index must empty as connections resubscribe and leave.

    A leak here is invisible in behaviour and unbounded in memory: the delivery tests
    above still pass while the index grows a stale entry per socket per resubscribe.
    """
    hub.reset_for_tests()

    watcher = hub.new_connection("conn-1", "watcher")
    other = hub.new_connection("conn-2", "other")
    hub.register(watcher)
    hub.register(other)

    hub.set_presence_subs(watcher, ["alice", "bob"])
    hub.set_presence_subs(other, ["alice"])
    assert hub._by_presence_sub["alice"] == {watcher, other}
    assert hub._by_presence_sub["bob"] == {watcher}

    # Narrowing a subscription drops the connection from the subject it left, and an
    # empty bucket is removed rather than kept as an empty set.
    hub.set_presence_subs(watcher, ["bob"])
    assert hub._by_presence_sub["alice"] == {other}
    assert watcher.presence_subs == {"bob"}

    hub.unregister(watcher)
    assert "bob" not in hub._by_presence_sub
    assert watcher.presence_subs == set()

    hub.unregister(other)
    assert hub._by_presence_sub == {}


def test_presence_reaches_only_the_connections_watching() -> None:
    hub.reset_for_tests()

    watcher = hub.new_connection("conn-1", "watcher")
    bystander = hub.new_connection("conn-2", "bystander")
    hub.register(watcher)
    hub.register(bystander)
    hub.set_presence_subs(watcher, ["alice"])

    hub.to_presence_subscribers("alice", {"t": "presence", "userId": "alice", "state": "active"})

    assert watcher.outbox.get_nowait()["userId"] == "alice"
    assert bystander.outbox.empty()
