"""An agent following a channel hears what was not addressed to it (ADR 0026).

Following is the one way an agent is sent a message that did not mention it, so the
rules are about restraint: an admin switches it on per channel; the run is told it was
not addressed; it gets read tools only; it shows the room no card and no typing; a run
that says nothing leaves no trace but the admin's run log; and a cooldown, a daily cap
and a guard that fails closed keep a busy channel from becoming a busy agent.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.jobs import agui_admission
from blob_api.plugins import agui

from .helpers import send_message
from .test_agent_tools import says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module
    frame,
    install,
    join_channel,
)
from .test_task_dispatch import (
    STOPS_TO_ASK,
    desk_fixture,  # noqa: F401 — the fake agent and its room
)
from .test_work_channels import PLANNER, PUBLISHES_A_DIFF

QUIET = b"".join(
    (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(type="RUN_FINISHED", threadId="t", runId="r"),
    )
)


async def follow(desk: dict[str, Any], channel_id: str | None = None) -> Any:
    return await desk["owner"].put(
        f"/api/admin/plugins/{desk['plugin_id']}/follows/{channel_id or desk['general']}"
    )


async def say(desk: dict[str, Any], body: str, *scripts: bytes, who: str = "owner") -> str:
    desk["state"]["scripts"] = list(scripts)
    sent = await send_message(desk[who], desk["general"], body)
    assert sent.status == 201, sent.body
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


async def runs(desk: dict[str, Any]) -> list[Any]:
    async with SessionFactory() as session:
        return list(
            (
                await session.execute(
                    text(
                        "SELECT id, status, addressed, post_count FROM agent_runs "
                        "WHERE plugin_id = :p ORDER BY started_at"
                    ),
                    {"p": desk["plugin_id"]},
                )
            ).fetchall()
        )


def run_frames(desk: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in desk["frames"] if str(f.get("t", "")).startswith("agent_run.")]


class TestSwitchingItOn:
    async def test_an_admin_follows_a_channel_the_agent_is_in(self, desk: dict[str, Any]) -> None:
        followed = await follow(desk)
        assert followed.status == 200, followed.body
        assert [c["name"] for c in followed.body["channels"]] == ["general"]
        listed = await desk["owner"].get(f"/api/admin/plugins/{desk['plugin_id']}/follows")
        assert [c["id"] for c in listed.body["channels"]] == [desk["general"]]

    async def test_only_an_admin_and_only_where_it_could_answer(self, desk: dict[str, Any]) -> None:
        refused = await desk["member"].put(
            f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}"
        )
        assert refused.status == 403
        elsewhere = (
            await desk["owner"].post("/api/channels", {"name": "quiet-room", "kind": "public"})
        ).body["channel"]["id"]
        not_in = await follow(desk, elsewhere)
        assert not_in.status == 400
        assert not_in.body["error"]["code"] == "agent_not_in_channel"
        dm = (await desk["owner"].post("/api/dms", {"userIds": [desk["member"].user_id]})).body[
            "channel"
        ]["id"]
        assert (await follow(desk, dm)).status in (400, 404)

    async def test_unfollowing_stops_it(self, desk: dict[str, Any]) -> None:
        await follow(desk)
        gone = await desk["owner"].delete(
            f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}"
        )
        assert gone.status == 200 and gone.body["channels"] == []
        await say(desk, "we shipped", says("Congrats!"))
        assert await runs(desk) == []


class TestReachingTheJob:
    async def test_a_message_that_mentions_nobody_is_still_handed_to_the_run_job(
        self, desk: dict[str, Any]
    ) -> None:
        """Found by running it for real: the send path queued a run only for a mention or
        an agent's DM, so a followed channel's messages never reached the job at all.
        These go through the send path rather than calling the job directly."""
        await follow(desk)
        sent = await send_message(desk["owner"], desk["general"], "the notes are late")
        assert ("agui_run", sent.body["message"]["id"]) in desk["enqueued"]

    async def test_an_unfollowed_channel_queues_nothing_for_a_plain_message(
        self, desk: dict[str, Any]
    ) -> None:
        sent = await send_message(desk["owner"], desk["general"], "the notes are late")
        assert ("agui_run", sent.body["message"]["id"]) not in desk["enqueued"]


class TestHearing:
    async def test_a_persons_message_starts_a_run_that_knows_it_was_not_addressed(
        self, desk: dict[str, Any]
    ) -> None:
        await follow(desk)
        await say(desk, "the release is blocked on the notes", says("I can draft the notes."))

        [run] = await runs(desk)
        assert run.addressed is False and run.status == "succeeded"
        sent = json.loads(desk["state"]["seen"][-1].content)
        context = {item["description"]: item["value"] for item in sent["context"]}
        assert context["addressed"] == agui.NOT_ADDRESSED
        # What it said is a message in the room, as anyone's is.
        bodies = [m["body"] for m in await messages(desk)]
        assert "I can draft the notes." in bodies

    async def test_it_shows_the_room_no_card_and_no_typing(self, desk: dict[str, Any]) -> None:
        await follow(desk)
        await say(desk, "anyone around?", says("I am."))
        assert run_frames(desk) == []
        assert not [f for f in desk["frames"] if f.get("t") == "typing"]

    async def test_a_run_that_said_nothing_is_nowhere_but_the_admins_log(
        self, desk: dict[str, Any]
    ) -> None:
        await follow(desk)
        await say(desk, "lunch?", QUIET)
        [run] = await runs(desk)
        assert run.post_count == 0
        mine = (await desk["owner"].get("/api/agent-runs")).body["runs"]
        assert str(run.id) not in [r["id"] for r in mine]
        here = (await desk["owner"].get(f"/api/channels/{desk['general']}/agent-runs")).body["runs"]
        assert here == []
        logged = (await desk["owner"].get(f"/api/admin/plugins/{desk['plugin_id']}/runs")).body
        assert str(run.id) in [r["id"] for r in logged["runs"]]

    async def test_it_gets_read_tools_only_whatever_its_access(self, desk: dict[str, Any]) -> None:
        granted = await desk["owner"].post(
            f"/api/admin/plugins/{desk['plugin_id']}/tools",
            {"access": "write", "approval": "auto_everywhere"},
        )
        assert granted.status == 200, granted.body
        await follow(desk)
        await say(desk, "what's new?", QUIET)
        offered = {tool["name"] for tool in json.loads(desk["state"]["seen"][-1].content)["tools"]}
        assert "post_message" not in offered and "ask_agent" not in offered
        assert "read_channel" in offered

    async def test_a_mention_is_one_run_addressed_not_two(self, desk: dict[str, Any]) -> None:
        await follow(desk)
        await say(desk, "@Helper what is left?", says("Two reviews."))
        [run] = await runs(desk)
        assert run.addressed is True
        assert len(desk["state"]["seen"]) == 1


class TestLookingNotActing:
    """It may look and answer in its own words — and nothing else (review of A1)."""

    async def test_its_own_question_asks_nobody_and_waits_on_nobody(
        self, desk: dict[str, Any]
    ) -> None:
        await follow(desk)
        await say(desk, "should we ship on Friday?", STOPS_TO_ASK)
        [run] = await runs(desk)
        assert run.status == "succeeded"
        assert not any(m["body"].startswith("Needs a decision") for m in await messages(desk))
        assert run_frames(desk) == []

    async def test_its_reply_naming_another_agent_starts_no_hop(self, desk: dict[str, Any]) -> None:
        planner = await install(desk["owner"], **PLANNER)
        await join_channel(desk["owner"], planner, desk["general"])
        await follow(desk)
        await say(desk, "who has the plan?", says("@Planner would know."))
        assert "@Planner would know." in [m["body"] for m in await messages(desk)]
        hops = [job for job in desk["enqueued"] if job[0] == "agui_run" and len(job) == 3]
        assert hops == [], "a hop is a job with a parent run; a follow starts none"

    async def test_it_publishes_nothing_into_a_work_channel_it_follows(
        self, desk: dict[str, Any]
    ) -> None:
        root = await send_message(desk["owner"], desk["general"], "Rate limiting for the API")
        started = await desk["owner"].post(
            "/api/work",
            {
                "rootMessageId": root.body["message"]["id"],
                "title": "Rate limiting",
                "agentPluginIds": [desk["plugin_id"]],
            },
        )
        assert started.status == 201, started.body
        work_channel = started.body["channel"]["id"]
        assert (await follow(desk, work_channel)).status == 200
        before = await count_artifacts()
        desk["state"]["scripts"] = [b"".join(PUBLISHES_A_DIFF)]
        sent = await send_message(desk["owner"], work_channel, "how is it going?")
        await agui_job.handle_agui_run(str(sent.body["message"]["id"]))
        # The run itself went through — it is the artifacts that were withheld.
        assert [(r.status, r.addressed) for r in await runs(desk)][-1] == ("succeeded", False)
        assert await count_artifacts() == before


async def count_artifacts() -> int:
    async with SessionFactory() as session:
        return int(
            (await session.execute(text("SELECT count(*) FROM work_artifacts"))).scalar_one()
        )


class TestRestraint:
    async def test_a_second_message_inside_the_cooldown_is_not_heard(
        self, desk: dict[str, Any]
    ) -> None:
        await follow(desk)
        await say(desk, "first", QUIET)
        await say(desk, "second", QUIET)
        assert len(await runs(desk)) == 1

    async def test_past_the_days_cap_it_stops_listening(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(agui_admission, "FOLLOW_COOLDOWN_SEC", 1)
        monkeypatch.setattr(agui_admission, "FOLLOW_DAILY_CAP", 1)
        await follow(desk)
        await say(desk, "first", QUIET)
        from blob_api.lib.redis import redis

        await redis.delete(f"follow:quiet:{desk['plugin_id']}:{desk['general']}")
        await say(desk, "second", QUIET)
        assert len(await runs(desk)) == 1

    async def test_without_redis_it_does_not_follow_but_a_mention_still_works(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        await follow(desk)

        async def away(*_a: Any, **_k: Any) -> Any:
            raise ConnectionError("redis is away")

        monkeypatch.setattr(agui_admission.redis, "set", away)
        await say(desk, "anyone?", says("Me!"))
        assert await runs(desk) == []
        await say(desk, "@Helper are you there?", says("Yes."))
        [run] = await runs(desk)
        assert run.addressed is True

    async def test_an_agent_only_its_owner_commands_hears_only_its_owner(
        self, desk: dict[str, Any]
    ) -> None:
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE plugins SET owner_user_id = :u WHERE id = :p"),
                {"u": desk["owner"].user_id, "p": desk["plugin_id"]},
            )
        await follow(desk)
        await say(desk, "from the member", QUIET, who="member")
        assert await runs(desk) == []
        await say(desk, "from its owner", QUIET)
        assert len(await runs(desk)) == 1

    async def test_agents_switched_off_hear_nothing_and_refuse_nothing(
        self, desk: dict[str, Any]
    ) -> None:
        await follow(desk)
        off = await desk["owner"].patch(
            "/api/admin/settings", {"settings": {"agentsEnabled": False}}
        )
        assert off.status == 200, off.body
        await say(desk, "anyone?", says("Me!"))
        assert await runs(desk) == []
        assert run_frames(desk) == []


async def messages(desk: dict[str, Any]) -> list[dict[str, Any]]:
    return list(
        (await desk["owner"].get(f"/api/channels/{desk['general']}/messages")).body["messages"]
    )
