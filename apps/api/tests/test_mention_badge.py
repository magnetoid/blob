"""The mention badge counts mentions you have not read.

`increment_mentions` added one unconditionally and had never looked at the read cursor,
while `mark_unread` right beside it recomputes the badge as "mentions strictly after the
cursor" and says in a comment that it must. So the two disagreed, and the one that ran on
every message was the one that was wrong.

It is not a rare race. The socket frame reaches a client in milliseconds and it marks
read at once; the notify job is picked up on the worker's poll about half a second later.
For anyone actually looking at the channel the increment lands *after* the read, so the
badge claimed a mention for a message on their screen — and in a DM, where every message
counts as a mention, on each one.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from blob_api.jobs.notify import handle_notify

from .helpers import Client, invite_and_sign_up, send_message, sign_up

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def pair(client: Client) -> dict:
    owner = await sign_up(client, "Badge Owner")
    other = await invite_and_sign_up(owner, "Badge Other")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    await owner.post(f"/api/channels/{general}/members", {"userIds": [other.user_id]})
    return {"owner": owner, "other": other, "channel": general}


async def badge_for(who: Client, channel_id: str) -> int:
    states = (await who.get("/api/read-states")).body["readStates"]
    for state in states:
        if state["channelId"] == channel_id:
            return int(state["mentionCount"])
    return 0


class TestAMentionYouHaveNotRead:
    async def test_raises_the_badge(self, pair: dict) -> None:
        sent = await send_message(pair["other"], pair["channel"], "@Badge Owner are you there")

        await handle_notify(sent.body["message"]["id"])

        assert await badge_for(pair["owner"], pair["channel"]) == 1

    async def test_a_second_one_raises_it_again(self, pair: dict) -> None:
        for _ in range(2):
            sent = await send_message(pair["other"], pair["channel"], "@Badge Owner ping")
            await handle_notify(sent.body["message"]["id"])

        assert await badge_for(pair["owner"], pair["channel"]) == 2


class TestAMentionYouHaveAlreadyRead:
    async def test_does_not_raise_the_badge(self, pair: dict) -> None:
        # The order that actually happens: the message arrives over the socket, the
        # client marks read, and only then does the worker get to the notify job.
        sent = await send_message(pair["other"], pair["channel"], "@Badge Owner look at this")
        message_id = sent.body["message"]["id"]
        await pair["owner"].post(
            f"/api/channels/{pair['channel']}/read", {"lastReadMessageId": message_id}
        )

        await handle_notify(message_id)

        assert await badge_for(pair["owner"], pair["channel"]) == 0

    async def test_and_leaves_an_earlier_unread_one_counted(self, pair: dict) -> None:
        # Reading the newest must not be taken as reading only the newest: the badge is
        # a count of what is after the cursor, so an older unread mention still stands.
        first = await send_message(pair["other"], pair["channel"], "@Badge Owner one")
        await handle_notify(first.body["message"]["id"])

        second = await send_message(pair["other"], pair["channel"], "@Badge Owner two")
        await pair["owner"].post(
            f"/api/channels/{pair['channel']}/read",
            {"lastReadMessageId": first.body["message"]["id"]},
        )
        await handle_notify(second.body["message"]["id"])

        # The first was read, the second was not.
        assert await badge_for(pair["owner"], pair["channel"]) == 1


class TestReadingTheChannel:
    async def test_clears_the_badge(self, pair: dict) -> None:
        sent = await send_message(pair["other"], pair["channel"], "@Badge Owner hello")
        await handle_notify(sent.body["message"]["id"])
        assert await badge_for(pair["owner"], pair["channel"]) == 1

        await pair["owner"].post(
            f"/api/channels/{pair['channel']}/read",
            {"lastReadMessageId": sent.body["message"]["id"]},
        )

        assert await badge_for(pair["owner"], pair["channel"]) == 0
