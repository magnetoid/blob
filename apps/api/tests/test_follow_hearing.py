"""What an agent following a channel hears (M4, ADR 0026's addendum).

Every message, as before; only a message that carries a file; or only a question nobody
answered within a quiet time an admin chose — handed on by a sweep rather than as it is
posted, "unanswered" meaning exactly what it means for the nudges (ADR 0015), on the
asker's authority, and answered in the question's own thread.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import agui
from blob_api.services import agent_follows

from .helpers import send_message, workspace_id_of
from .test_agent_follows import QUIET, runs, say
from .test_agent_tools import says
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import desk_fixture  # noqa: F401 — the fake agent and its room


async def hear(desk: dict[str, Any], body: dict[str, Any] | None = None) -> Any:
    return await desk["owner"].put(
        f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}", body
    )


async def listed(desk: dict[str, Any]) -> dict[str, Any]:
    got = await desk["owner"].get(f"/api/admin/plugins/{desk['plugin_id']}/follows")
    assert got.status == 200, got.body
    [channel] = got.body["channels"]
    return channel


async def ask(desk: dict[str, Any], body: str = "Where are the deploy notes?") -> str:
    """A person's question at the top of the channel, through the send path."""
    sent = await send_message(desk["member"], desk["general"], body)
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def due(minutes_from_now: float) -> list[tuple[str, str]]:
    """What the sweep would hand on that many minutes from now. Ahead rather than back:
    a UUIDv7 id carries its own time, which a backdated `created_at` would contradict."""
    async with SessionFactory() as session:
        return await agent_follows.unanswered_questions(
            session, now=datetime.now(UTC) + timedelta(minutes=minutes_from_now)
        )


def context_of(request: Any) -> dict[str, str]:
    return {item["description"]: item["value"] for item in json.loads(request.content)["context"]}


async def thread_root_of(body: str) -> Any:
    """The thread a message with this text was posted in."""
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT thread_root_id FROM messages WHERE body = :body"), {"body": body}
            )
        ).scalar_one_or_none()


class TestChoosing:
    async def test_a_follow_hears_everything_until_told_otherwise(
        self, desk: dict[str, Any]
    ) -> None:
        assert (await hear(desk)).status == 200
        channel = await listed(desk)
        assert channel["hears"] == "everything" and channel["quietMinutes"] is None

    async def test_unanswered_questions_with_a_quiet_time_and_a_bare_put_keeps_it(
        self, desk: dict[str, Any]
    ) -> None:
        set_ = await hear(desk, {"hears": "unanswered", "quietMinutes": 240})
        assert set_.status == 200, set_.body
        assert (await listed(desk))["quietMinutes"] == 240
        # The switch's own PUT carries no body: it must not undo the choice.
        assert (await hear(desk)).status == 200
        channel = await listed(desk)
        assert channel["hears"] == "unanswered" and channel["quietMinutes"] == 240

    async def test_unanswered_waits_an_hour_unless_told(self, desk: dict[str, Any]) -> None:
        assert (await hear(desk, {"hears": "unanswered"})).status == 200
        assert (await listed(desk))["quietMinutes"] == 60

    @pytest.mark.parametrize(
        "body", [{"hears": "unanswered", "quietMinutes": 45}, {"hears": "loud"}]
    )
    async def test_what_it_cannot_hear_is_refused(
        self, desk: dict[str, Any], body: dict[str, Any]
    ) -> None:
        refused = await hear(desk, body)
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "invalid_input"


async def with_attachment(desk: dict[str, Any], body: str, *, kind: str = "file") -> str:
    """A message carrying an attachment, as if it had been uploaded: the row is what the
    follow reads, and no agent here is sent the bytes."""
    sent = await send_message(desk["owner"], desk["general"], body)
    message_id = str(sent.body["message"]["id"])
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO attachments (id, workspace_id, uploader_id, object_key, filename,
                                         mime, size_bytes, message_id, kind)
                VALUES (:id, :ws, :up, :key, 'attached', 'application/pdf', 1234, :m, :kind)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "ws": await workspace_id_of(desk["owner"]),
                "up": desk["owner"].user_id,
                "key": f"test/{uuid.uuid4()}",
                "m": message_id,
                "kind": kind,
            },
        )
    return message_id


class TestFiles:
    async def test_a_voice_message_is_not_a_file_here(self, desk: dict[str, Any]) -> None:
        """A recording wakes no follower (ADR 0035): its words are still to come."""
        assert (await hear(desk, {"hears": "files"})).status == 200
        message_id = await with_attachment(desk, "a recording", kind="voice")
        desk["state"]["scripts"] = [QUIET]
        await agui_job.handle_agui_run(message_id)
        assert await runs(desk) == []

    async def test_it_hears_a_message_with_a_file_and_not_one_without(
        self, desk: dict[str, Any]
    ) -> None:
        assert (await hear(desk, {"hears": "files"})).status == 200
        await say(desk, "the notes are late", QUIET)
        assert await runs(desk) == []

        message_id = await with_attachment(desk, "the contract, signed")
        desk["state"]["scripts"] = [QUIET]
        await agui_job.handle_agui_run(message_id)
        [run] = await runs(desk)
        assert run.addressed is False


class TestUnansweredQuestions:
    async def test_it_hears_nothing_as_the_question_is_posted(self, desk: dict[str, Any]) -> None:
        assert (await hear(desk, {"hears": "unanswered", "quietMinutes": 30})).status == 200
        question = await ask(desk)
        # Not even handed to the run job: nothing hears this channel's messages as posted.
        assert ("agui_run", question) not in desk["enqueued"]
        await agui_job.handle_agui_run(question)
        assert await runs(desk) == []

    async def test_handed_on_once_its_quiet_time_has_passed_and_not_before(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        question = await ask(desk)
        assert await due(10) == []
        assert await due(31) == [(question, desk["plugin_id"])]
        # A late answer from an agent nobody asked is worse than none.
        assert await due(30 + agent_follows.LATE_LOOKBACK_MINUTES + 2) == []

    async def test_the_run_is_the_askers_says_why_and_answers_in_the_thread(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        question = await ask(desk)
        desk["state"]["scripts"] = [says("They are in the ops channel.")]

        await agui_job.handle_follow_late(question, desk["plugin_id"])

        [run] = await runs(desk)
        assert run.addressed is False
        async with SessionFactory() as session:
            found = (
                await session.execute(
                    text(
                        "SELECT trigger_message_id, initiated_by_user_id FROM agent_runs"
                        " WHERE id = :id"
                    ),
                    {"id": run.id},
                )
            ).one()
        assert str(found.trigger_message_id) == question
        assert str(found.initiated_by_user_id) == desk["member"].user_id
        said = context_of(desk["state"]["seen"][-1])["addressed"]
        assert "gone half an hour without an answer" in said
        assert str(await thread_root_of("They are in the ops channel.")) == question

        # Once: run on it, it is not handed on again.
        assert await due(31) == []

    async def test_an_answered_question_is_never_handed_on(self, desk: dict[str, Any]) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        question = await ask(desk)
        replied = await send_message(
            desk["owner"], desk["general"], "In #ops.", threadRootId=question
        )
        assert replied.status == 201, replied.body
        assert await due(31) == []

    async def test_an_answer_between_the_sweep_and_the_run_stops_it(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        question = await ask(desk)
        assert await due(31) == [(question, desk["plugin_id"])]
        await send_message(desk["owner"], desk["general"], "In #ops.", threadRootId=question)

        await agui_job.handle_follow_late(question, desk["plugin_id"])
        assert await runs(desk) == []

    async def test_a_question_that_mentioned_the_agent_was_already_answered_by_it(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        question = await say(desk, "@Helper where are the deploy notes?", QUIET, who="member")
        assert len(await runs(desk)) == 1
        assert await due(31) == []
        assert question

    async def test_only_a_follow_for_unanswered_questions_is_swept(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "files"})
        await ask(desk)
        assert await due(31) == []

    async def test_an_agent_no_longer_in_the_channel_hears_nothing(
        self, desk: dict[str, Any]
    ) -> None:
        await hear(desk, {"hears": "unanswered", "quietMinutes": 30})
        await ask(desk)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("DELETE FROM channel_members WHERE channel_id = :c AND user_id = :u"),
                {"c": desk["general"], "u": desk["bot"]},
            )
        assert await due(31) == []

    async def test_the_sweep_queues_one_run_per_question_and_agent(
        self, desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def found(_session: Any, *, now: datetime) -> list[tuple[str, str]]:
            assert now.tzinfo is not None
            return [("q1", "p1"), ("q2", "p1")]

        monkeypatch.setattr(agent_follows, "unanswered_questions", found)
        assert await agui_job.hear_unanswered_questions() == 2
        assert ("agui_follow_late", "q1", "p1") in desk["enqueued"]
        assert ("agui_follow_late", "q2", "p1") in desk["enqueued"]


@pytest.mark.parametrize(
    ("minutes", "said"),
    [(30, "half an hour"), (60, "an hour"), (240, "4 hours"), (1440, "a day")],
)
def test_the_run_is_told_how_long_the_question_waited(minutes: int, said: str) -> None:
    assert f"gone {said} without an answer" in agui.unanswered_note(minutes)
