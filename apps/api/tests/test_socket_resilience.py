"""What a socket survives, and what it stops overwriting.

Two failures that both wore the same disguise — everything looked like it was working.

A frame the reader could not handle raised out of `_reader`, and `asyncio.wait` stores a
task's exception rather than raising it, so the exception surfaced from inside the
`finally` and skipped the four lines after it: the connection stayed in the hub's fan-out
maps for the life of the process and was never announced offline. One frame from any
authenticated client was enough. `"x"` is valid JSON and is not a dict.

And `/away` lasted one heartbeat. The ping branch called `mark_active`, which is a
*statement* about somebody, every twenty-five seconds.
"""

from __future__ import annotations

import json

import pytest_asyncio

from blob_api.lib.redis import presence_key, redis
from blob_api.realtime import hub, presence

from .helpers import Client, sign_up

# Imported from the realtime suite rather than copied: `socket_for` is where the ASGI
# WebSocket transport is set up, and two of those would drift.
from .test_realtime import receive_until, socket_for


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Owner")


class TestAFrameItCannotHandle:
    async def test_a_json_string_does_not_leak_the_connection(self, owner: Client) -> None:
        # `receive_json` is a bare `json.loads`, so this parses and is not a dict.
        before = len(hub._by_connection)

        async with socket_for(owner) as ws:
            await receive_until(ws, "hello")
            await ws.send_text(json.dumps("x"))
            # Still answering: an unusable frame is ignored, not fatal.
            await ws.send_text(json.dumps({"t": "ping"}))
            await receive_until(ws, "pong")

        assert len(hub._by_connection) == before

    async def test_and_neither_does_an_id_that_is_not_one(self, owner: Client) -> None:
        # These go into `cast(:ids AS uuid[])`. `IdParam` guards path params and request
        # bodies; a socket frame has no schema layer to refuse it.
        before = len(hub._by_connection)

        async with socket_for(owner) as ws:
            await receive_until(ws, "hello")
            await ws.send_text(json.dumps({"t": "presence.sub", "userIds": ["not-a-uuid"]}))
            await ws.send_text(json.dumps({"t": "ping"}))
            await receive_until(ws, "pong")

        assert len(hub._by_connection) == before

    async def test_userids_that_are_not_even_a_list(self, owner: Client) -> None:
        # `for uid in "abc"` yields characters, which is how a bare string got this far.
        async with socket_for(owner) as ws:
            await receive_until(ws, "hello")
            await ws.send_text(json.dumps({"t": "presence.sub", "userIds": "abc"}))
            await ws.send_text(json.dumps({"t": "ping"}))

            assert await receive_until(ws, "pong") is not None


class TestBeingAway:
    async def test_a_heartbeat_does_not_undo_it(self, owner: Client) -> None:
        await presence.mark_away(owner.user_id)

        # What the ping branch calls, twenty-five seconds apart, for as long as the tab
        # is open. It used to be `mark_active`.
        await presence.mark_present(owner.user_id)

        assert await redis.get(presence_key(owner.user_id)) == "away"

    async def test_but_it_still_decides_for_somebody_who_has_not(self, owner: Client) -> None:
        await redis.delete(presence_key(owner.user_id))

        await presence.mark_present(owner.user_id)

        assert await redis.get(presence_key(owner.user_id)) == "active"

    async def test_and_the_command_still_brings_you_back(self, owner: Client) -> None:
        await presence.mark_away(owner.user_id)
        await presence.mark_present(owner.user_id)

        # `/away` is a toggle and reads presence to decide which way it goes. With the
        # heartbeat flipping it to "active", running it twice said "You're now away."
        # both times and the second one never took.
        channels = (await owner.get("/api/channels")).body["channels"]
        back = await owner.post(
            "/api/commands",
            {"channelId": channels[0]["id"], "text": "/away", "clientMsgId": "away-command-1"},
        )

        # Asserted on what the person is told rather than on Redis: the router applies
        # the new state with `fire_and_forget`, so the key is a race and the sentence
        # is not. Before the fix this read "You're now away." a second time, because the
        # toggle had already been flipped back underneath it.
        assert back.status == 200, back.body
        assert back.body["ephemeral"] == "You're back."
