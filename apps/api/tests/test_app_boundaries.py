"""What an installed app may reach, say, and leave behind.

Four holes in the same wall, each one quiet. An event that named no channel reached every
app in the workspace including channels their bot would get a 404 for; an image block
could point anywhere and turn a message into a tracking pixel; a socket agent could call
itself half a megabyte of text; and uninstalling an app kept both its address and its
mentionable name hostage for ever, so the same app could never be installed again.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.lib.errors import AppError
from blob_api.plugins.blocks import validate_blocks
from blob_api.plugins.events import CHANNEL_SCOPED

from .helpers import Client, invite_and_sign_up, sign_up

APP = {
    "slug": "standup-bot",
    "name": "Standup Bot",
    "description": "Collects standup notes",
    "runtime": "external",
    "version": "1.0.0",
    "requestUrl": "https://apps.example.com/blob/events",
    "events": ["message.created"],
    "scopes": ["messages:read", "messages:write", "channels:read"],
}


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    return {"owner": owner, "member": member, "general": channels[0]["id"]}


async def install(owner: Client, **overrides: object) -> dict:
    made = await owner.post("/api/admin/plugins", {**APP, **overrides})
    assert made.status == 201, made.body
    return made.body


class TestWhatAnEventCarries:
    def test_a_task_event_says_where_it_happened(self) -> None:
        # `CHANNEL_SCOPED` is the list `emit` enforces: an event on it without a channel
        # raises rather than delivering. A task carries the title and the instructions
        # somebody typed, and names the channel it was raised in — so it belongs here,
        # beside thread.summary.updated, which describes the very same conversation.
        assert "task.created" in CHANNEL_SCOPED
        assert "task.updated" in CHANNEL_SCOPED

    async def test_and_the_emit_refuses_one_that_does_not(self) -> None:
        from blob_api.plugins import events as plugin_events

        async with SessionFactory() as session:
            with pytest.raises(ValueError):
                await plugin_events.emit(
                    session,
                    workspace_id="00000000-0000-0000-0000-000000000000",
                    event="task.created",
                    payload={},
                )


class TestWhatABlockMayPointAt:
    def test_an_image_stays_on_this_workspace(self) -> None:
        ok = validate_blocks([{"type": "image", "url": "/api/files/abc", "alt": "a chart"}])
        assert ok is not None

    @pytest.mark.parametrize(
        "url",
        [
            "https://tracker.example/p.gif",
            "http://tracker.example/p.gif",
            "//tracker.example/p.gif",
            "/\\tracker.example/p.gif",
        ],
    )
    def test_an_image_somewhere_else_is_refused(self, url: str) -> None:
        # Every reader who scrolls past fetches it, which hands the app's author their
        # address, their user agent and the moment they read — from a channel the app's
        # own bot may not even be in. The field's comment always said so; nothing
        # enforced it.
        with pytest.raises(AppError):
            validate_blocks([{"type": "image", "url": url}])


class TestUninstalling:
    async def test_the_same_app_can_be_installed_again(self, team: dict) -> None:
        # The bot's address is derived from the slug, so a retired bot held the identity
        # of the app it used to be: the reinstall hit the users unique index and answered
        # 500, with no way back short of editing the database.
        first = await install(team["owner"])
        gone = await team["owner"].delete(f"/api/admin/plugins/{first['plugin']['id']}")
        assert gone.status == 200, gone.body

        again = await team["owner"].post("/api/admin/plugins", APP)

        assert again.status == 201, again.body
        assert again.body["plugin"]["botUserId"] != first["plugin"]["botUserId"]

    async def test_it_gives_back_the_name(self, team: dict) -> None:
        # `workspace_handles` holds rows for active users only — the mention resolver
        # reads it with no deactivated filter *because* of that. A retired bot left its
        # row behind, so it stayed mentionable and its name stayed unclaimable.
        made = await install(team["owner"])
        bot_user_id = made["plugin"]["botUserId"]
        await team["owner"].delete(f"/api/admin/plugins/{made['plugin']['id']}")

        async with SessionFactory() as session:
            held = (
                await session.execute(
                    sql("SELECT 1 FROM workspace_handles WHERE user_id = cast(:id AS uuid)"),
                    {"id": bot_user_id},
                )
            ).fetchone()

        assert held is None

    async def test_a_person_may_then_take_that_name(self, team: dict) -> None:
        made = await install(team["owner"])
        await team["owner"].delete(f"/api/admin/plugins/{made['plugin']['id']}")

        renamed = await team["member"].patch("/api/me", {"displayName": "Standup Bot"})

        assert renamed.status == 200, renamed.body


class TestWhatASocketAgentMayCallItself:
    async def test_a_name_of_any_length_is_not_stored(self, team: dict) -> None:
        # This arrives in a `hello` frame from a process on somebody's laptop, and the
        # frame cap is 512KB. Without a bound, an agent could store half a megabyte of
        # text as its own name and have every admin console render it on every load.
        from blob_api.plugins import registry

        made = await install(
            team["owner"], runtime="socket", requestUrl=None, events=[], slug="socket-bot"
        )
        plugin_id = made["plugin"]["id"]
        workspace_id = (await team["owner"].get("/api/bootstrap")).body["workspace"]["id"]

        async with SessionFactory() as session, session.begin():
            await registry.describe(
                session,
                plugin_id=plugin_id,
                workspace_id=workspace_id,
                name="A" * 5_000,
                description="B" * 5_000,
                version="not-a-version",
            )

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        app = next(p for p in listed if p["id"] == plugin_id)
        # Each field kept what the manifest put there, rather than what the frame said.
        assert app["name"] == APP["name"]
        assert app["version"] == APP["version"]

    async def test_but_a_reasonable_one_still_lands(self, team: dict) -> None:
        from blob_api.plugins import registry

        made = await install(
            team["owner"], runtime="socket", requestUrl=None, events=[], slug="socket-bot"
        )
        plugin_id = made["plugin"]["id"]

        async with SessionFactory() as session, session.begin():
            await registry.describe(
                session,
                plugin_id=plugin_id,
                workspace_id=(await team["owner"].get("/api/bootstrap")).body["workspace"]["id"],
                name="Standup Bot",
                version="2.1.0",
            )

        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        app = next(p for p in listed if p["id"] == plugin_id)
        assert app["version"] == "2.1.0"
