"""A DM with an agent is a conversation with it: the room is the address.

Until this, only the agent Blob ran itself answered its DM without a mention. The rule is
now a property of the agent — `answers_dm_without_mention`, set by the seeder — or of
the room being one person's with their own agent. It is still never "any bot in a DM":
an app somebody installed by hand needs a mention in its DM, because a run per line typed
at it is a change to its author's contract.

Every agent here is a fake external one (`test_agui.agent_speaks`), or the seeded Janus
answered by the same fake transport, because that is what an agent now is.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.jobs.agui_admission import personal_agent_for

from .helpers import (
    Client,
    allow_policy,
    invite_and_sign_up,
    send_message,
    sign_up,
    workspace_id_of,
)
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    agent_speaks,
    frame,
    install,
    route_agent_to,
)


def says(text_: str) -> tuple[bytes, ...]:
    """A complete AG-UI reply: one text message, then the run finishes."""
    return (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(type="TEXT_MESSAGE_START", messageId="m1", role="assistant"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta=text_),
        frame(type="TEXT_MESSAGE_END", messageId="m1"),
        frame(type="RUN_FINISHED", threadId="t", runId="r"),
    )


@pytest.fixture
def janus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
    monkeypatch.setattr(settings, "JANUS_AGENT_NAME", "Janus")


async def bot_named(owner: Client, name: str) -> str:
    people = (await owner.get("/api/users")).body["users"]
    return str(next(u["id"] for u in people if u["displayName"] == name))


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
async def mine(janus: None, client: Client, monkeypatch: pytest.MonkeyPatch) -> dict:
    """A founder, their DM with the seeded agent, and the fake that answers for it."""
    owner = await sign_up(client, "Ada")
    bot_id = await bot_named(owner, settings.JANUS_AGENT_NAME)
    transport, seen = agent_speaks(*says("Morning."))
    route_agent_to(monkeypatch, transport)
    return {"owner": owner, "bot_id": bot_id, "dm": await open_dm(owner, bot_id), "seen": seen}


class TestTheRoomIsTheAddress:
    async def test_the_seeded_agent_answers_without_being_mentioned(self, mine: dict) -> None:
        await say(mine["owner"], mine["dm"], "morning")

        # No `@Janus`. There is nobody else in the room it could have been meant for, and
        # making people type a name at a wall is ceremony Slack does not ask for either.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]

    async def test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict) -> None:
        await say(mine["owner"], mine["dm"], f"@{settings.JANUS_AGENT_NAME} hello")

        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]

    async def test_its_own_replies_do_not_start_another_run(self, mine: dict) -> None:
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
        # removing the mention requirement must not have weakened it.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]
        assert len(mine["seen"]) == 1


class TestWhoElseIsInTheRoom:
    async def test_a_dm_with_a_person_is_untouched(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        pair = await open_dm(mine["owner"], str(bo.user_id))

        await say(mine["owner"], pair, "lunch?")

        assert await replies_in(mine["owner"], pair) == []
        assert mine["seen"] == []

    async def test_a_third_member_stops_it_answering(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        pair = await open_dm(mine["owner"], str(bo.user_id))
        apps = (await mine["owner"].get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == "janus")
        joined = await mine["owner"].post(f"/api/admin/plugins/{plugin_id}/channels/{pair}")
        assert joined.status == 200, joined.body

        await say(mine["owner"], pair, "no mention here")

        # Three members, still labelled 'dm': `kind` is derived once at creation and
        # `app_join_channel` has no kind test. Answering would put an agent told "nobody
        # else can read this" into a room Bo is reading.
        assert await replies_in(mine["owner"], pair) == []

    async def test_a_group_dm_is_not_a_personal_room(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        trio = await open_dm(mine["owner"], str(bo.user_id), mine["bot_id"])

        await say(mine["owner"], trio, "no mention here")

        assert await replies_in(mine["owner"], trio) == []


class TestWhichAgentsTheRoomAddresses:
    async def test_an_app_installed_by_hand_still_needs_a_mention(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Ada")
        app_body = await install(owner)
        transport, seen = agent_speaks(*says("I was not asked."))
        route_agent_to(monkeypatch, transport)
        their_dm = await open_dm(owner, str(app_body["plugin"]["botUserId"]))

        await say(owner, their_dm, "hello?")

        # A run per line typed at it would be a change to its author's contract.
        assert await replies_in(owner, their_dm) == []
        assert seen == []

    async def test_a_persons_own_agent_answers_its_owner(self, client: Client) -> None:
        # A personal agent dials in over a socket, so the run itself cannot complete
        # here; what is pinned is that the room is its address — the job finds it.
        owner = await sign_up(client, "Ada")
        workspace_id = await workspace_id_of(owner)
        await allow_policy(workspace_id)
        attached = await owner.post("/api/agents/mine", {"name": "Desktop Claude"})
        assert attached.status == 201, attached.body
        bot_id = await bot_named(owner, "Desktop Claude")
        dm = await open_dm(owner, bot_id)

        async with SessionFactory() as session:
            listener = await personal_agent_for(session, workspace_id=workspace_id, channel_id=dm)
        assert listener is not None and listener.bot_user_id == bot_id

    async def test_somebody_elses_agent_does_not_answer_you(self, client: Client) -> None:
        owner = await sign_up(client, "Ada")
        workspace_id = await workspace_id_of(owner)
        await allow_policy(workspace_id)
        assert (await owner.post("/api/agents/mine", {"name": "Desktop Claude"})).status == 201
        bot_id = await bot_named(owner, "Desktop Claude")
        bo = await invite_and_sign_up(owner, "Bo")
        dm = await open_dm(bo, bot_id)

        async with SessionFactory() as session:
            listener = await personal_agent_for(session, workspace_id=workspace_id, channel_id=dm)
        assert listener is None


def record_jobs(monkeypatch: pytest.MonkeyPatch) -> list[tuple[Any, ...]]:
    """Every `enqueue(...)` call, recorded at call time rather than when it runs."""
    seen: list[tuple[Any, ...]] = []

    async def nothing() -> None:
        return None

    def record(job: str, *args: Any) -> Any:
        seen.append((job, *args))
        return nothing()

    from blob_api.lib import queue as queue_module
    from blob_api.services import messages as messages_service

    monkeypatch.setattr(queue_module, "enqueue", record)
    monkeypatch.setattr(messages_service, "enqueue", record, raising=False)
    return seen


class TestTheWayIn:
    """Sending is what has to start the run, not a test calling the job by hand."""

    async def test_a_plain_message_in_the_agents_dm_asks_for_a_run(
        self, mine: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        jobs = record_jobs(monkeypatch)
        sent = await send_message(mine["owner"], mine["dm"], "what did I miss?")

        assert ("agui_run", str(sent.body["message"]["id"])) in jobs

    async def test_a_dm_between_two_people_asks_for_nothing(
        self, mine: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        room = await open_dm(mine["owner"], str(bo.user_id))

        jobs = record_jobs(monkeypatch)
        await send_message(mine["owner"], room, "lunch?")

        assert not [job for job in jobs if job[0] == "agui_run"]

    async def test_an_app_installed_by_hand_asks_for_nothing(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Ada")
        app_body = await install(owner)
        their_dm = await open_dm(owner, str(app_body["plugin"]["botUserId"]))

        jobs = record_jobs(monkeypatch)
        await send_message(owner, their_dm, "hello?")

        assert not [job for job in jobs if job[0] == "agui_run"]
