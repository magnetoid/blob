"""Slash commands.

The cases worth pinning are the ones where a command differs from a message: an unknown
name has to be a soft answer rather than a 400, an ephemeral reply has to leave nothing
behind in the channel, and a command that posts has to be as idempotent as a send — it
goes through the same write path, and a retried request must not double-post.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "general": general}


async def run(client: Client, channel_id: str, text: str, **extra: object) -> dict:
    payload = {"channelId": channel_id, "text": text, "clientMsgId": client_msg_id(), **extra}
    response = await client.post("/api/commands", payload)
    assert response.status == 200, response.body
    return response.body


# ─── dispatch ─────────────────────────────────────────────────────────────────
async def test_an_unknown_command_answers_rather_than_failing(team: dict) -> None:
    # A typo must not be a red banner, and once apps register commands it may simply be
    # a command that exists in someone else's workspace.
    body = await run(team["owner"], team["general"]["id"], "/deploy the thing")
    assert body["message"] is None
    assert "/deploy" in body["ephemeral"]


async def test_text_that_is_not_a_command_is_refused(team: dict) -> None:
    response = await team["owner"].post(
        "/api/commands",
        {
            "channelId": team["general"]["id"],
            "text": "not a command",
            "clientMsgId": client_msg_id(),
        },
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "invalid_input"


async def test_a_lone_slash_is_not_a_command(team: dict) -> None:
    response = await team["owner"].post(
        "/api/commands",
        {"channelId": team["general"]["id"], "text": "/", "clientMsgId": client_msg_id()},
    )
    assert response.status == 400


# ─── ephemeral ────────────────────────────────────────────────────────────────
async def test_help_lists_commands_and_posts_nothing(team: dict) -> None:
    channel_id = team["general"]["id"]
    body = await run(team["owner"], channel_id, "/help")

    assert body["message"] is None
    assert "/shrug" in body["ephemeral"]

    # The whole point of ephemeral: the channel is untouched.
    history = (await team["owner"].get(f"/api/channels/{channel_id}/messages")).body
    assert history["messages"] == []


async def test_an_ephemeral_reply_is_not_visible_to_anyone_else(team: dict) -> None:
    channel_id = team["general"]["id"]
    await run(team["owner"], channel_id, "/help")

    seen = (await team["member"].get(f"/api/channels/{channel_id}/messages")).body["messages"]
    assert seen == []


# ─── commands that post ───────────────────────────────────────────────────────
async def test_shrug_posts_a_message(team: dict) -> None:
    body = await run(team["owner"], team["general"]["id"], "/shrug it happens")
    assert body["message"]["body"] == "it happens ¯\\_(ツ)_/¯"


async def test_shrug_alone_still_posts_the_shrug(team: dict) -> None:
    body = await run(team["owner"], team["general"]["id"], "/shrug")
    assert body["message"]["body"] == "¯\\_(ツ)_/¯"


async def test_me_posts_an_action_in_italics(team: dict) -> None:
    body = await run(team["owner"], team["general"]["id"], "/me waves")
    assert body["message"]["body"] == "_waves_"


async def test_me_with_nothing_to_do_explains_itself(team: dict) -> None:
    body = await run(team["owner"], team["general"]["id"], "/me")
    assert body["message"] is None
    assert "/me" in body["ephemeral"]


async def test_a_command_that_posts_is_idempotent(team: dict) -> None:
    channel_id = team["general"]["id"]
    same_id = client_msg_id()
    payload = {"channelId": channel_id, "text": "/shrug twice", "clientMsgId": same_id}

    first = await team["owner"].post("/api/commands", payload)
    second = await team["owner"].post("/api/commands", payload)

    assert first.body["message"]["id"] == second.body["message"]["id"]
    history = (await team["owner"].get(f"/api/channels/{channel_id}/messages")).body
    assert len(history["messages"]) == 1


# ─── commands that change the channel ─────────────────────────────────────────
async def test_topic_sets_the_topic(team: dict) -> None:
    channel_id = team["general"]["id"]
    body = await run(team["owner"], channel_id, "/topic release day")

    assert "release day" in body["ephemeral"]
    channel = (await team["owner"].get(f"/api/channels/{channel_id}")).body["channel"]
    assert channel["topic"] == "release day"


async def test_topic_with_no_argument_clears_it(team: dict) -> None:
    channel_id = team["general"]["id"]
    await run(team["owner"], channel_id, "/topic release day")
    await run(team["owner"], channel_id, "/topic")

    channel = (await team["owner"].get(f"/api/channels/{channel_id}")).body["channel"]
    assert channel["topic"] in (None, "")


async def test_leave_removes_the_member(team: dict) -> None:
    channel_id = team["general"]["id"]
    body = await run(team["member"], channel_id, "/leave")
    assert "left" in body["ephemeral"].lower()

    channels = (await team["member"].get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["id"] == channel_id)
    assert general["membership"] is None


# ─── access ───────────────────────────────────────────────────────────────────
async def test_a_command_cannot_reach_a_channel_you_are_not_in(team: dict) -> None:
    private = (
        await team["owner"].post(
            "/api/channels", {"name": "secret-plans", "kind": "private"}
        )
    ).body["channel"]

    response = await team["member"].post(
        "/api/commands",
        {"channelId": private["id"], "text": "/shrug", "clientMsgId": client_msg_id()},
    )
    # A private channel's existence is private, so this is 404 rather than 403.
    assert response.status == 404


@pytest.mark.parametrize("command", ["/topic nope", "/leave"])
async def test_direct_messages_refuse_channel_commands(team: dict, command: str) -> None:
    dm = (
        await team["owner"].post("/api/dms", {"userIds": [team["member"].user_id]})
    ).body["channel"]

    body = await run(team["owner"], dm["id"], command)
    assert body["message"] is None
    assert body["ephemeral"]
