"""`/remind` for somebody else, and for a channel (M3 · B3).

Slack's three forms. Somebody else gets a message from you in the conversation the two of
you have; a channel gets one from you, where you could post it now. Each reads back whom
it is for and when, and each refuses where the person typing could not otherwise reach.
"""

from __future__ import annotations

from typing import Any

import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def two(client: Client) -> dict[str, Any]:
    ana = await sign_up(client, "Ana Reminds")
    bo = await invite_and_sign_up(ana, "Bo Reminded")
    channels = (await ana.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    return {"ana": ana, "bo": bo, "general": general}


async def run(person: Client, channel_id: str, text: str) -> Any:
    answer = await person.post(
        "/api/commands", {"channelId": channel_id, "text": text, "clientMsgId": client_msg_id()}
    )
    assert answer.status == 200, answer.body
    return answer.body


async def test_somebody_else_gets_it_from_you_in_your_conversation(two: dict[str, Any]) -> None:
    said = await run(
        two["ana"], two["general"], "/remind @Bo Reminded to send the deck tomorrow at 9"
    )
    assert said["ephemeral"].startswith("Reminder for Bo Reminded set for ")
    assert said["message"] is None
    (scheduled,) = (await two["ana"].get("/api/scheduled")).body["scheduled"]
    assert scheduled["body"] == "Reminder: send the deck"
    dm = next(
        c
        for c in (await two["ana"].get("/api/channels")).body["channels"]
        if c["id"] == scheduled["channelId"]
    )
    assert dm["kind"] == "dm" and set(dm["memberIds"]) == {two["ana"].user_id, two["bo"].user_id}


async def test_a_channel_gets_it_from_you(two: dict[str, Any]) -> None:
    said = await run(
        two["ana"], two["general"], "/remind #general to post the notes every Friday at 4pm"
    )
    assert said["ephemeral"].startswith(
        "Reminder in #general set — every week at 16:00, starting Fri"
    )
    (scheduled,) = (await two["ana"].get("/api/scheduled")).body["scheduled"]
    assert scheduled["channelId"] == two["general"]
    assert scheduled["body"] == "Reminder: post the notes"


async def test_only_where_you_could_post(two: dict[str, Any]) -> None:
    made = await two["ana"].post("/api/channels", {"name": "board", "kind": "private"})
    assert made.status in (200, 201), made.body
    hidden = await run(two["bo"], two["general"], "/remind #board to look at this tomorrow at 9")
    assert hidden["ephemeral"] == "There is no channel by that name."

    news = await two["ana"].post("/api/channels", {"name": "news", "kind": "public"})
    room = news.body["channel"]["id"]
    await two["ana"].post(f"/api/channels/{room}/members", {"userIds": [two["bo"].user_id]})
    await two["ana"].patch(f"/api/channels/{room}", {"posting": "admins"})
    refused = await run(two["bo"], two["general"], "/remind #news to celebrate tomorrow at 9")
    assert refused["ephemeral"].startswith("Only admins post in #news.")
    assert (await two["bo"].get("/api/scheduled")).body["scheduled"] == []


async def test_without_a_time_it_says_how(two: dict[str, Any]) -> None:
    said = await run(two["ana"], two["general"], "/remind @Bo Reminded to send the deck")
    assert said["ephemeral"].startswith("I didn't catch a time.")
    assert "/remind @Ana" in said["ephemeral"]


async def test_yourself_by_name_is_yourself(two: dict[str, Any]) -> None:
    said = await run(two["ana"], two["general"], "/remind @Ana Reminds to stretch in 1 hour")
    assert said["ephemeral"].startswith("Reminder set for ")
    (scheduled,) = (await two["ana"].get("/api/scheduled")).body["scheduled"]
    assert scheduled["body"] == "stretch"
