"""Structured message content, and the one check that makes interactions safe.

An interaction is accepted only if its `actionId` appears in the blocks stored on that
message. The server holds those blocks, so a client cannot invent an action and an app
cannot be handed an id it never published — which is the whole security story, and the
reason most of this file is about refusing things.
"""

from __future__ import annotations

import pytest

from blob_api.lib import net
from blob_api.lib.errors import AppError
from blob_api.plugins.blocks import action_ids_of, validate_blocks

from .helpers import Client, invite_and_sign_up, sign_up

APP = {
    "slug": "deploy-bot",
    "name": "Deploy Bot",
    "runtime": "external",
    "version": "1.0.0",
    "requestUrl": "https://apps.example.com/blob/events",
    "events": ["interaction.triggered"],
    "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"],
}

BLOCKS = [
    {"type": "section", "text": {"text": "Build **passed** on `main`"}},
    {"type": "divider"},
    {
        "type": "actions",
        "elements": [
            {"type": "button", "actionId": "deploy", "text": "Deploy", "style": "primary"},
            {"type": "button", "actionId": "cancel", "text": "Cancel"},
        ],
    },
]


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


def test_the_vocabulary_is_closed() -> None:
    """A block type nobody wrote a renderer for must not reach one."""
    with pytest.raises(AppError):
        validate_blocks([{"type": "iframe", "url": "https://example.com"}])
    with pytest.raises(AppError):
        validate_blocks([{"type": "script", "text": {"text": "x"}}])


def test_unknown_keys_are_dropped_rather_than_stored() -> None:
    """What is stored is what the schema allows, so nothing extra reaches the renderer."""
    stored = validate_blocks([{"type": "divider", "onclick": "alert(1)"}])
    assert stored == [{"type": "divider"}]


def test_an_action_id_has_to_look_like_one() -> None:
    with pytest.raises(AppError) as caught:
        validate_blocks(
            [
                {
                    "type": "actions",
                    "elements": [{"type": "button", "actionId": "a b!", "text": "x"}],
                }
            ]
        )
    assert caught.value.code == "bad_action_id"


def test_action_ids_are_collected_from_every_shape() -> None:
    stored = validate_blocks(
        [
            {
                "type": "actions",
                "elements": [
                    {"type": "button", "actionId": "go", "text": "Go"},
                    {
                        "type": "select",
                        "actionId": "env",
                        "options": [{"label": "prod", "value": "p"}],
                    },
                ],
            },
            {"type": "input", "actionId": "note", "label": "Why?"},
        ]
    )
    assert action_ids_of(stored) == {"go", "env", "note"}


async def _bot_with_blocks(client: Client) -> tuple[Client, str, str]:
    """An app that has posted a message carrying buttons."""
    owner = await sign_up(client, "Owner")
    installed = await owner.post("/api/admin/plugins", APP)
    token = installed.body["botToken"]

    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")

    bot = owner.fork()
    bot._http.headers["authorization"] = f"Bearer {token}"
    await bot.post("/api/v1/conversations.join", {"channel": general["id"]})
    posted = await bot.post(
        "/api/v1/chat.postMessage",
        {"channel": general["id"], "text": "Build passed", "blocks": BLOCKS},
    )
    assert posted.status == 201, posted.body
    return owner, posted.body["message"]["id"], general["id"]


async def test_a_bot_posts_blocks_and_they_come_back(client: Client) -> None:
    owner, message_id, channel_id = await _bot_with_blocks(client)

    history = (await owner.get(f"/api/channels/{channel_id}/messages")).body["messages"]
    posted = next(m for m in history if m["id"] == message_id)

    assert posted["blocks"][0]["type"] == "section"
    # The text stays the fallback, and remains what search reads.
    assert posted["body"] == "Build passed"
    assert posted["pluginId"]


async def test_a_forged_action_is_refused(client: Client) -> None:
    owner, message_id, _ = await _bot_with_blocks(client)

    forged = await owner.post(
        "/api/interactions", {"messageId": message_id, "actionId": "rm-rf", "value": ""}
    )
    assert forged.status == 400
    assert forged.body["error"]["code"] == "unknown_action"


async def test_a_published_action_is_accepted(client: Client) -> None:
    owner, message_id, _ = await _bot_with_blocks(client)

    accepted = await owner.post(
        "/api/interactions", {"messageId": message_id, "actionId": "deploy", "value": "now"}
    )
    assert accepted.status == 200


async def test_someone_who_cannot_see_the_message_cannot_press_its_buttons(
    client: Client,
) -> None:
    """Pressing a button requires being able to read the message it is on.

    Everyone joins #general, so this needs a channel the outsider is genuinely not in —
    otherwise the test proves only that the fixture works.
    """
    owner = await sign_up(client, "Owner")
    installed = await owner.post("/api/admin/plugins", APP)
    bot_user_id = installed.body["plugin"]["botUserId"]

    private = (
        await owner.post(
            "/api/channels",
            {"name": "war-room", "kind": "private", "memberIds": [bot_user_id]},
        )
    ).body["channel"]

    bot = owner.fork()
    bot._http.headers["authorization"] = f"Bearer {installed.body['botToken']}"
    posted = await bot.post(
        "/api/v1/chat.postMessage",
        {"channel": private["id"], "text": "Ship it?", "blocks": BLOCKS},
    )
    assert posted.status == 201, posted.body
    message_id = posted.body["message"]["id"]

    outsider = await invite_and_sign_up(owner, "Outsider")
    denied = await outsider.post(
        "/api/interactions", {"messageId": message_id, "actionId": "deploy", "value": ""}
    )
    # 404, not 403: a private channel's existence is private, so the answer is the same
    # one someone would get for a message that never existed.
    assert denied.status == 404

    # The owner, who is in the channel, can.
    allowed = await owner.post(
        "/api/interactions", {"messageId": message_id, "actionId": "deploy", "value": ""}
    )
    assert allowed.status == 200


async def test_a_deleted_message_takes_its_buttons_with_it(client: Client) -> None:
    owner, message_id, _ = await _bot_with_blocks(client)
    assert (await owner.delete(f"/api/messages/{message_id}")).status == 200

    gone = await owner.post(
        "/api/interactions", {"messageId": message_id, "actionId": "deploy", "value": ""}
    )
    assert gone.status == 404
