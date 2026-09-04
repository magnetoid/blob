"""Slash commands provided by an app.

Against a real socket, for the same reason `test_plugin_delivery` is: what is under test
is a signed request going out and a reply coming back, and a mocked client would only
prove the mock works.

The cases that matter are the ones where an app is not a cooperative participant — it is
slow, it is silent, it answers rubbish, it was removed from the channel while it was
thinking, or it wants a name another app already holds.
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
from blob_api.lib.errors import AppError
from blob_api.plugins import commands as app_transport
from blob_api.plugins import registry
from blob_api.plugins.manifest import CommandDecl, Manifest
from blob_api.services import commands as command_service

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@dataclass(slots=True)
class Received:
    headers: dict[str, str]
    body: bytes


@dataclass(slots=True)
class FakeApp:
    """An app that answers a command with whatever it has been told to say."""

    port: int = 0
    status: int = 200
    reply: bytes = b""
    #: Seconds to stall before answering, for exercising the timeout.
    delay: float = 0.0
    requests: list[Received] = field(default_factory=list)


@pytest_asyncio.fixture
async def fake_app() -> AsyncIterator[FakeApp]:
    app = FakeApp()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await reader.readuntil(b"\r\n\r\n")
            headers = {}
            for line in head.decode("latin-1").split("\r\n")[1:]:
                if ": " in line:
                    name, _, value = line.partition(": ")
                    headers[name.lower()] = value
            length = int(headers.get("content-length", "0"))
            body = await reader.readexactly(length) if length else b""
            app.requests.append(Received(headers=headers, body=body))

            if app.delay:
                await asyncio.sleep(app.delay)

            writer.write(
                f"HTTP/1.1 {app.status} X\r\ncontent-length: {len(app.reply)}\r\n"
                f"content-type: application/json\r\n\r\n".encode()
                + app.reply
            )
            await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    app.port = server.sockets[0].getsockname()[1]
    async with server:
        await server.start_serving()
        yield app


async def workspace_of(user_id: str) -> str:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT workspace_id FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()
    assert row is not None
    return str(row.workspace_id)


async def install_app(
    owner: Client,
    *,
    port: int,
    slug: str = "deployer",
    commands: list[CommandDecl] | None = None,
    scopes: list[str] | None = None,
) -> str:
    """Install through the registry.

    Not through the HTTP endpoint: the SSRF guard correctly refuses a loopback URL, and
    that guard is registration's business and is tested where it belongs.
    """
    manifest = Manifest(
        slug=slug,
        name=slug.title(),
        runtime="external",
        request_url=f"http://127.0.0.1:{port}/commands",
        scopes=scopes if scopes is not None else ["messages:write", "commands"],
        commands=commands
        if commands is not None
        else [CommandDecl(name="deploy", usage="<env>", summary="Deploy something.")],
    )
    workspace_id = await workspace_of(owner.user_id)
    async with SessionFactory() as session:
        async with session.begin():
            installed = await registry.install(
                session,
                workspace_id=workspace_id,
                manifest=manifest,
                installed_by=owner.user_id,
                reserved_commands=command_service.builtin_names(),
            )
    return installed.plugin_id


async def add_bot_to_channel(plugin_id: str, channel_id: str) -> str:
    async with SessionFactory() as session:
        async with session.begin():
            bot_id = await registry.bot_user_id(session, plugin_id)
            await session.execute(
                text(
                    """
                    INSERT INTO channel_members (channel_id, user_id)
                    VALUES (:c, :u) ON CONFLICT DO NOTHING
                    """
                ),
                {"c": channel_id, "u": bot_id},
            )
    assert bot_id is not None
    return bot_id


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "general": general}


async def run(client: Client, channel_id: str, text_input: str) -> dict:
    response = await client.post(
        "/api/commands",
        {"channelId": channel_id, "text": text_input, "clientMsgId": client_msg_id()},
    )
    assert response.status == 200, response.body
    return response.body


# ─── declaring commands ───────────────────────────────────────────────────────
async def test_an_app_cannot_claim_a_built_in_name(team: dict, fake_app: FakeApp) -> None:
    with pytest.raises(AppError) as caught:
        await install_app(
            team["owner"],
            port=fake_app.port,
            commands=[CommandDecl(name="help", summary="Nope.")],
        )
    assert caught.value.code == "command_reserved"


async def test_commands_need_the_commands_scope(team: dict, fake_app: FakeApp) -> None:
    with pytest.raises(AppError) as caught:
        await install_app(
            team["owner"],
            port=fake_app.port,
            scopes=["messages:write"],
        )
    assert caught.value.code == "scope_required"


async def test_two_apps_cannot_hold_the_same_command(team: dict, fake_app: FakeApp) -> None:
    await install_app(team["owner"], port=fake_app.port)

    with pytest.raises(AppError) as caught:
        await install_app(
            team["owner"],
            port=fake_app.port,
            slug="other-app",
        )
    assert caught.value.code == "command_conflict"
    assert "/deploy" in caught.value.message


async def test_an_app_command_appears_in_the_bootstrap_list(team: dict, fake_app: FakeApp) -> None:
    await install_app(team["owner"], port=fake_app.port)

    boot = (await team["owner"].get("/api/bootstrap")).body
    names = [c["name"] for c in boot["commands"]]
    assert "deploy" in names
    # Sorted together with the built-ins rather than appended after them.
    assert names == sorted(names)


# ─── dispatch ─────────────────────────────────────────────────────────────────
async def test_an_app_answers_a_command_privately(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.reply = json.dumps({"responseType": "ephemeral", "text": "Deploying web."}).encode()

    body = await run(team["owner"], team["general"]["id"], "/deploy web")

    assert body["ephemeral"] == "Deploying web."
    assert body["message"] is None

    sent = json.loads(fake_app.requests[0].body)
    assert sent["command"] == "/deploy"
    assert sent["text"] == "web"
    assert sent["channelId"] == team["general"]["id"]
    assert "/api/hooks/commands/" in sent["responseUrl"]
    # Signed like every other delivery, so an app verifies it the way it already does.
    assert fake_app.requests[0].headers["x-blob-signature"].startswith("v0=")


async def test_an_app_can_answer_in_the_channel(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    bot_id = await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.reply = json.dumps({"responseType": "in_channel", "text": "Deployed."}).encode()

    body = await run(team["owner"], team["general"]["id"], "/deploy web")

    assert body["message"]["body"] == "Deployed."
    assert body["message"]["authorId"] == bot_id
    assert body["message"]["kind"] == "bot"

    history = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body[
        "messages"
    ]
    assert [m["body"] for m in history] == ["Deployed."]


async def test_a_slow_app_is_not_a_broken_one(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.delay = app_transport.REQUEST_TIMEOUT_SEC + 0.5

    body = await run(team["owner"], team["general"]["id"], "/deploy web")

    assert "Working on it" in body["ephemeral"]
    assert body["message"] is None


async def test_an_app_that_says_nothing_is_told_to_answer_later(
    team: dict, fake_app: FakeApp
) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.status = 202

    body = await run(team["owner"], team["general"]["id"], "/deploy web")
    assert "Working on it" in body["ephemeral"]


async def test_rubbish_from_an_app_is_not_shown_to_the_person(
    team: dict, fake_app: FakeApp
) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.reply = b"<html>500 oh no</html>"

    body = await run(team["owner"], team["general"]["id"], "/deploy web")
    assert "Working on it" in body["ephemeral"]
    assert "html" not in body["ephemeral"]


async def test_an_app_not_in_the_channel_is_not_asked(team: dict, fake_app: FakeApp) -> None:
    await install_app(team["owner"], port=fake_app.port)

    body = await run(team["owner"], team["general"]["id"], "/deploy web")

    assert "added to this channel" in body["ephemeral"]
    assert fake_app.requests == []


async def test_a_disabled_app_stops_answering(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text("UPDATE plugins SET status = 'disabled' WHERE id = :id"), {"id": plugin_id}
            )

    body = await run(team["owner"], team["general"]["id"], "/deploy web")
    assert "isn't a command here" in body["ephemeral"]
    assert fake_app.requests == []


# ─── deferred answers ─────────────────────────────────────────────────────────
async def test_a_response_token_round_trips() -> None:
    token = app_transport.response_token(plugin_id="p", channel_id="c", user_id="u")
    target = app_transport.verify_response_token(token)
    assert target is not None
    assert (target.plugin_id, target.channel_id, target.user_id) == ("p", "c", "u")


async def test_a_tampered_token_is_refused() -> None:
    token = app_transport.response_token(plugin_id="p", channel_id="c", user_id="u")
    body, _, signature = token.partition(".")
    assert app_transport.verify_response_token(f"{body}x.{signature}") is None
    assert app_transport.verify_response_token("nonsense") is None


async def test_an_expired_token_is_refused() -> None:
    token = app_transport.response_token(plugin_id="p", channel_id="c", user_id="u", now=0)
    assert app_transport.verify_response_token(token) is None


async def test_an_app_answers_later_through_its_response_url(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    bot_id = await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.status = 202

    await run(team["owner"], team["general"]["id"], "/deploy web")
    response_url = json.loads(fake_app.requests[0].body)["responseUrl"]
    path = response_url.split("/api/hooks/", 1)[1]

    # The app comes back with the real answer, holding no session of any kind.
    late = await team["owner"].post(
        f"/api/hooks/{path}", {"responseType": "in_channel", "text": "Deployed at last."}
    )
    assert late.status == 200

    history = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body[
        "messages"
    ]
    assert [m["body"] for m in history] == ["Deployed at last."]
    assert history[0]["authorId"] == bot_id


async def test_the_same_deferred_answer_twice_posts_once(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.status = 202

    await run(team["owner"], team["general"]["id"], "/deploy web")
    path = json.loads(fake_app.requests[0].body)["responseUrl"].split("/api/hooks/", 1)[1]
    payload = {"responseType": "in_channel", "text": "Deployed."}

    await team["owner"].post(f"/api/hooks/{path}", payload)
    await team["owner"].post(f"/api/hooks/{path}", payload)

    history = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body[
        "messages"
    ]
    assert len(history) == 1


async def test_two_different_deferred_answers_both_post(team: dict, fake_app: FakeApp) -> None:
    plugin_id = await install_app(team["owner"], port=fake_app.port)
    await add_bot_to_channel(plugin_id, team["general"]["id"])
    fake_app.status = 202

    await run(team["owner"], team["general"]["id"], "/deploy web")
    path = json.loads(fake_app.requests[0].body)["responseUrl"].split("/api/hooks/", 1)[1]

    await team["owner"].post(f"/api/hooks/{path}", {"responseType": "in_channel", "text": "Step 1"})
    await team["owner"].post(f"/api/hooks/{path}", {"responseType": "in_channel", "text": "Step 2"})

    history = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body[
        "messages"
    ]
    assert [m["body"] for m in history] == ["Step 1", "Step 2"]


async def test_a_forged_response_url_is_refused(team: dict) -> None:
    response = await team["owner"].post(
        "/api/hooks/commands/not-a-real-token", {"text": "I am not an app."}
    )
    assert response.status == 400


# ─── whose app it is ──────────────────────────────────────────────────────────
class TestAnOwnedAppsCommands:
    """Ownership has to cover the slash command, or it covers nothing.

    An owned agent answers only its owner when mentioned. If `/deploy` still ran for
    anybody who typed it, the rule would be bypassable by reading the composer's list —
    which offers every app command in the workspace.
    """

    @staticmethod
    async def give_to(plugin_id: str, user_id: str) -> None:
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE plugins SET owner_user_id = :u WHERE id = :p"),
                    {"u": user_id, "p": plugin_id},
                )

    async def test_the_owner_can_still_run_it(self, team: dict, fake_app: FakeApp) -> None:
        plugin_id = await install_app(team["owner"], port=fake_app.port)
        await add_bot_to_channel(plugin_id, team["general"]["id"])
        await self.give_to(plugin_id, team["owner"].user_id)
        fake_app.reply = json.dumps({"text": "Deploying."}).encode()

        answered = await run(team["owner"], team["general"]["id"], "/deploy web")

        assert "Deploying." in answered["ephemeral"]

    async def test_somebody_else_cannot(self, team: dict, fake_app: FakeApp) -> None:
        member = await invite_and_sign_up(team["owner"], "Member")
        plugin_id = await install_app(team["owner"], port=fake_app.port)
        await add_bot_to_channel(plugin_id, team["general"]["id"])
        await self.give_to(plugin_id, team["owner"].user_id)

        answered = await run(member, team["general"]["id"], "/deploy web")

        # Word for word what an unclaimed name answers, so which apps a workspace has
        # cannot be enumerated by watching which refusal comes back.
        assert "isn't a command here" in answered["ephemeral"]
        assert fake_app.requests == []

    async def test_it_leaves_their_composer_list(self, team: dict, fake_app: FakeApp) -> None:
        # Offering a command that will answer "isn't a command here" is worse than not
        # offering it: the person reads the list as what they can do.
        member = await invite_and_sign_up(team["owner"], "Member")
        plugin_id = await install_app(team["owner"], port=fake_app.port)
        await self.give_to(plugin_id, team["owner"].user_id)

        mine = (await team["owner"].get("/api/bootstrap")).body["commands"]
        theirs = (await member.get("/api/bootstrap")).body["commands"]

        assert "deploy" in [c["name"] for c in mine]
        assert "deploy" not in [c["name"] for c in theirs]

    async def test_lending_it_puts_the_command_back(self, team: dict, fake_app: FakeApp) -> None:
        member = await invite_and_sign_up(team["owner"], "Member")
        plugin_id = await install_app(team["owner"], port=fake_app.port)
        await add_bot_to_channel(plugin_id, team["general"]["id"])
        await self.give_to(plugin_id, team["owner"].user_id)
        bot_name = None
        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT display_name FROM users WHERE bot_plugin_id = :p"),
                    {"p": plugin_id},
                )
            ).fetchone()
            bot_name = None if row is None else row.display_name
        assert bot_name

        await run(team["owner"], team["general"]["id"], f"/allow @{bot_name} @Member")
        fake_app.reply = json.dumps({"text": "Deploying."}).encode()

        answered = await run(member, team["general"]["id"], "/deploy web")

        assert "Deploying." in answered["ephemeral"]
