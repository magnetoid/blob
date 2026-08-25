"""Your own agent, which is the workspace agent in a room with only you in it.

There is no second bot, no per-person plugin and no migration behind this. A DM with the
built-in agent is already a private two-member room that nobody else can read, so the
room is what makes the conversation personal — and because there is nobody else in it to
address, a mention would be ceremony. That is also Slack's rule for a DM, which is the
one that matters most: it is the reflex people already have.

The condition that has to hold is narrower than "kind is dm", and these pin why. `kind`
is set from the member count when a DM is created and never re-derived, while
`app_join_channel` adds a bot to a channel with no kind test at all — so a `kind='dm'`
row can hold three members, and trusting the label would put a model told "nobody else
can read this" into a room somebody else is reading.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import builtin
from blob_api.realtime import presence
from blob_api.services import workspace_agent

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    install,
)
from .test_builtin_agent import anthropic_says, model  # noqa: F401 — a fixture, by name


async def agent_user_id(owner: Client) -> str:
    people = (await owner.get("/api/users")).body["users"]
    return str(next(u["id"] for u in people if u["displayName"] == workspace_agent.AGENT_NAME))


async def open_dm(owner: Client, *user_ids: str) -> str:
    response = await owner.post("/api/dms", {"userIds": list(user_ids)})
    assert response.status == 200, response.body
    return str(response.body["channel"]["id"])


async def say(owner: Client, channel_id: str, body: str) -> str:
    sent = await send_message(owner, channel_id, body)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


async def replies_in(owner: Client, channel_id: str) -> list[str]:
    history = (await owner.get(f"/api/channels/{channel_id}/messages")).body["messages"]
    return [m["body"] for m in history if m["kind"] == "bot"]


@pytest.fixture
async def mine(model: dict, client: Client) -> dict:  # noqa: F811
    """A founder, and their DM with the workspace agent."""
    owner = await sign_up(client, "Ada")
    bot_id = await agent_user_id(owner)
    return {"owner": owner, "bot_id": bot_id, "dm": await open_dm(owner, bot_id), "model": model}


class TestTheRoomIsTheAddress:
    async def test_it_answers_without_being_mentioned(self, mine: dict) -> None:
        mine["model"]["transport"] = anthropic_says("Morning.")

        await say(mine["owner"], mine["dm"], "morning")

        # No `@Blob`. There is nobody else in the room it could have been meant for, and
        # making people type a name at a wall is ceremony Slack does not ask for either.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]

    async def test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict) -> None:
        mine["model"]["transport"] = anthropic_says("Once.")

        await say(mine["owner"], mine["dm"], f"@{workspace_agent.AGENT_NAME} hello")

        # People do this out of habit. Both paths find the same plugin, and the dedupe is
        # what stops one message producing two answers.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Once."]

    async def test_its_own_replies_do_not_start_another_run(self, mine: dict) -> None:
        mine["model"]["transport"] = anthropic_says("Hi.")
        await say(mine["owner"], mine["dm"], "hi")

        async with SessionFactory() as session:
            reply_id = (
                await session.execute(
                    text(
                        "SELECT id FROM messages WHERE channel_id = :c AND kind = 'bot' "
                        "ORDER BY id DESC LIMIT 1"
                    ),
                    {"c": mine["dm"]},
                )
            ).scalar_one()
        await agui_job.handle_agui_run(str(reply_id))

        # The loop guard is structural — only a `kind='user'` message is a trigger — and
        # removing the mention requirement must not have weakened it. In a DM an agent
        # that answered itself would run until the caps stopped it.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Hi."]


class TestWhoElseIsInTheRoom:
    async def test_a_dm_with_a_person_is_untouched(self, mine: dict, client: Client) -> None:
        colleague = await invite_and_sign_up(mine["owner"], "Bo")
        human_dm = await open_dm(mine["owner"], str(colleague.user_id))

        await say(mine["owner"], human_dm, "are we shipping?")

        assert await replies_in(mine["owner"], human_dm) == []

    async def test_a_third_member_stops_it_answering(self, mine: dict) -> None:
        colleague = await invite_and_sign_up(mine["owner"], "Bo")
        # The one way this happens for real: an admin adds the app to a channel they can
        # see, and `app_join_channel` has no kind test. `kind` stays 'dm' because it is
        # derived once at creation and never again.
        pair = await open_dm(mine["owner"], str(colleague.user_id))
        apps = (await mine["owner"].get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)
        joined = await mine["owner"].post(f"/api/admin/plugins/{plugin_id}/channels/{pair}")
        assert joined.status == 200, joined.body

        await say(mine["owner"], pair, "no mention here")

        # Three members, still labelled 'dm'. Answering would mean a model told "nobody
        # else can read this" writing into a room Bo is reading.
        assert await replies_in(mine["owner"], pair) == []

    async def test_a_group_dm_is_not_a_personal_room(self, mine: dict) -> None:
        colleague = await invite_and_sign_up(mine["owner"], "Bo")
        trio = await open_dm(mine["owner"], str(colleague.user_id), mine["bot_id"])

        await say(mine["owner"], trio, "no mention here")

        assert await replies_in(mine["owner"], trio) == []

    async def test_a_third_party_app_is_not_dragged_in(self, mine: dict) -> None:
        app_body = await install(mine["owner"])
        their_bot = str(app_body["plugin"]["botUserId"])
        their_dm = await open_dm(mine["owner"], their_bot)

        await say(mine["owner"], their_dm, "hello?")

        # Only the built-in runtime is addressed by the room. Widening this to "any bot in
        # a DM" would hand every installed app a run per line typed at it, with no
        # manifest opt-in and no way for its author to decline.
        assert await replies_in(mine["owner"], their_dm) == []


class TestWhatItIsTold:
    def test_a_dm_is_not_described_as_a_group_chat(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Acme", owner_name="Ada")
        prompt = builtin.system_prompt(persona, channel_name="a conversation")

        # The channel prompt says "a group chat" and "Everyone can see what you write".
        # Both are false here, and the second is false in the one room where a person is
        # most likely to say something they would not say in #general.
        assert "group chat" not in prompt
        assert "nobody else can read it" in prompt
        assert "no need to be mentioned" in prompt.lower()

    def test_it_is_told_to_admit_it_cannot_see_the_workspace(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Acme", owner_name="Ada")
        prompt = builtin.system_prompt(persona, channel_name="a conversation")

        # "What did I miss?" is the first thing anyone types at a personal assistant in a
        # work chat app, and this agent cannot see the answer. Told nothing, a chat model
        # writes a plausible standup summary out of thin air.
        assert "only this conversation" in prompt
        assert "do not invent an answer" in prompt

    def test_a_channel_is_still_described_as_a_channel(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Acme")
        prompt = builtin.system_prompt(persona, channel_name="general")

        assert "#general" in prompt
        assert "group chat" in prompt


class TestItLooksBusy:
    async def test_it_shows_as_typing_while_it_thinks(
        self, mine: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The room must not be empty while the model writes.

        Nothing reaches the client until an answer is *sealed* — `Fold` emits on
        TEXT_MESSAGE_END, not per delta — so a run is up to two minutes of silence. In a
        channel that reads as normal; in a DM, where the person is waiting, it is
        indistinguishable from the feature being broken.

        Asserted through Redis rather than the socket because the indicator's whole point
        is that it needs no new protocol: `set_typing` is the shipped path the client
        already renders, and the agent simply starts using it.
        """
        from blob_api.lib.redis import redis, typing_key

        seen: list[str] = []
        original = presence.set_typing

        async def watch(channel_id: str, user_id: str, thread_root_id: str | None) -> None:
            seen.append(user_id)
            await original(channel_id, user_id, thread_root_id)

        monkeypatch.setattr(presence, "set_typing", watch)
        await say(mine["owner"], mine["dm"], "think about it")

        # The bot, not the person, and in this channel.
        assert seen == [mine["bot_id"]]
        assert await redis.get(typing_key(mine["dm"], mine["bot_id"])) is not None


class TestTheRunLog:
    async def test_a_dm_run_is_recorded_like_any_other(self, mine: dict) -> None:
        apps = (await mine["owner"].get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)

        await say(mine["owner"], mine["dm"], "hello")

        runs = (await mine["owner"].get(f"/api/admin/plugins/{plugin_id}/runs")).body["runs"]
        assert [r["status"] for r in runs] == ["succeeded"]
        assert runs[0]["transport"] == "builtin"


class TestSeeding:
    async def test_reconciling_skips_a_workspace_that_already_has_it(self, mine: dict) -> None:
        workspace_id = await workspace_id_of(mine["owner"])

        assert await workspace_agent.ensure_everywhere() == 0

        async with SessionFactory() as session:
            count = (
                await session.execute(
                    text(
                        "SELECT count(*)::int FROM plugins WHERE workspace_id = :ws "
                        "AND slug = :slug"
                    ),
                    {"ws": workspace_id, "slug": builtin.WORKSPACE_SLUG},
                )
            ).scalar_one()
        assert count == 1
