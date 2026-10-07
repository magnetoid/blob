"""A task handed to an agent is a hand-off the agent answers (ADR 0023).

Assigning a task to an agent used to change one column and start nothing: the agent was
never told. These pin what an assignment does now — a message from the person who assigned
it, in the task's thread, addressed to the agent alone, which roots a chain on their
authority through the ordinary path — who may hand an agent work, and how the run's ending
moves the task without ever overwriting what a person decided in the meantime.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import agui as agui_job
from blob_api.plugins import streams
from blob_api.realtime import hub
from blob_api.services import agent_chains, task_dispatch
from blob_api.services import agentic as agentic_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_agent_tools import says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
)

STOPS_TO_ASK = b"".join(
    (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(
            type="RUN_FINISHED",
            outcome={
                "type": "interrupt",
                "interrupts": [
                    {
                        "id": "i1",
                        "message": "Include the risks?",
                        "responseSchema": {"type": "boolean"},
                    }
                ],
            },
        ),
    )
)


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`."""


@pytest_asyncio.fixture(name="desk")
async def desk_fixture(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Owner, member, #general, an AG-UI agent in it answering from scripts, and every
    job enqueue and socket frame recorded. Named apart from the parameter it fills so a
    module importing it (`test_run_transparency.py`) does not shadow it."""
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    app_body = await install(owner)
    await join_channel(owner, app_body, general)

    # One fake agent, answering each request with the next script; every request kept.
    state: dict[str, Any] = {"scripts": [], "seen": []}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        state["seen"].append(request)
        body = state["scripts"].pop(0) if state["scripts"] else says("(no more scripts)")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        if isinstance(kwargs.get("transport"), httpx.ASGITransport):
            return real(**kwargs)
        kwargs.pop("transport", None)
        return real(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    enqueued: list[tuple[Any, ...]] = []

    def record(job: str, *args: Any) -> Any:
        enqueued.append((job, *args))
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agent_chains, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)

    frames: list[dict[str, Any]] = []
    to_channel = hub.to_channel

    def heard(channel_id: str, event: dict[str, Any]) -> None:
        frames.append(event)
        to_channel(channel_id, event)

    monkeypatch.setattr(hub, "to_channel", heard)
    return {
        "owner": owner,
        "member": member,
        "general": general,
        "plugin_id": app_body["plugin"]["id"],
        "bot": app_body["plugin"]["botUserId"],
        "state": state,
        "enqueued": enqueued,
        "frames": frames,
    }


async def handed(
    desk: dict[str, Any],
    *,
    by: Client | None = None,
    where: str | None = None,
    title: str = "Draft the release notes",
    instructions: str = "Use this thread.",
    assignee: str | None = None,
) -> Any:
    """A thread with a task in it, handed to the agent (or whoever `assignee` is)."""
    root = await send_message(desk["owner"], where or desk["general"], "We shipped 1.8 today.")
    return await (by or desk["owner"]).post(
        f"/api/threads/{root.body['message']['id']}/tasks",
        {"title": title, "instructions": instructions, "assigneeUserId": assignee or desk["bot"]},
    )


async def run_handoff(desk: dict[str, Any], task: dict[str, Any], *scripts: bytes) -> None:
    desk["state"]["scripts"] = list(scripts)
    await agui_job.handle_agui_run(task["dispatchMessageId"])


async def row_of(table: str, row_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(text(f"SELECT * FROM {table} WHERE id = :id"), {"id": row_id})
        ).fetchone()


async def count(table: str) -> int:
    async with SessionFactory() as session:
        return int((await session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one())


async def own(desk: dict[str, Any], user_id: str) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE plugins SET owner_user_id = :u WHERE id = :p"),
            {"u": user_id, "p": desk["plugin_id"]},
        )


# ─── as arithmetic ────────────────────────────────────────────────────────────
class TestWhereARunLeavesItsTask:
    def test_an_answer_is_done_and_becomes_the_outcome(self) -> None:
        assert task_dispatch.outcome_of(
            "succeeded", "Helper", reason=None, answer="  The notes.  "
        ) == ("done", "The notes.")

    def test_silence_is_not_done(self) -> None:
        assert task_dispatch.outcome_of("succeeded", "Helper", reason=None, answer=None) == (
            "blocked",
            "Helper finished without answering.",
        )

    def test_stop_puts_it_back_to_do_and_keeps_the_outcome_it_had(self) -> None:
        assert task_dispatch.outcome_of("cancelled", "Helper", reason=None, answer="x") == (
            "todo",
            None,
        )

    def test_a_failure_a_refusal_and_an_unanswered_question_block_it_and_say_why(self) -> None:
        assert task_dispatch.outcome_of("failed", "Helper", reason="boom", answer=None) == (
            "blocked",
            "Helper could not finish: boom",
        )
        assert task_dispatch.outcome_of("refused", "Helper", reason="over budget", answer=None) == (
            "blocked",
            "Helper did not run: over budget",
        )
        assert task_dispatch.outcome_of("expired", "Helper", reason=None, answer=None) == (
            "blocked",
            "Nobody answered Helper's question in time.",
        )

    def test_a_long_answer_is_cut_for_the_task_and_whole_in_the_thread(self) -> None:
        status, outcome = task_dispatch.outcome_of(
            "succeeded", "Helper", reason=None, answer="x" * 5000
        )
        assert status == "done"
        assert outcome is not None and len(outcome) == task_dispatch.OUTCOME_MAX_CHARS
        assert outcome.endswith("…")

    def test_the_hand_off_addresses_the_agent_and_bolds_the_task(self) -> None:
        assert task_dispatch.handoff_body("Helper", " Notes ", "") == (
            "@Helper — a task for you: **Notes**"
        )
        assert task_dispatch.handoff_body("Helper", "Notes", " From here. ") == (
            "@Helper — a task for you: **Notes**\n\nFrom here."
        )


# ─── through the API and the run ──────────────────────────────────────────────
class TestHandingATaskToAnAgent:
    async def test_it_is_answered_without_anybody_mentioning_it(self, desk: dict[str, Any]) -> None:
        created = await handed(desk)
        assert created.status == 201, created.body
        task = created.body["task"]
        assert task["status"] == "in_progress"
        assert task["dispatchMessageId"]

        # The hand-off: the assigner's own message, in the task's thread, to the agent.
        handoff = await row_of("messages", task["dispatchMessageId"])
        assert str(handoff.author_id) == desk["owner"].user_id
        assert handoff.kind == "user"
        assert str(handoff.thread_root_id) == task["threadRootId"]
        assert handoff.body == (
            "@Helper — a task for you: **Draft the release notes**\n\nUse this thread."
        )
        assert [str(u) for u in handoff.mention_user_ids] == [desk["bot"]]
        assert ("agui_run", task["dispatchMessageId"]) in desk["enqueued"]

        await run_handoff(desk, task, says("Notes: 1.8 shipped with meetups."))

        # The run was told the task, beside the hand-off that says it in words.
        sent = json.loads(desk["state"]["seen"][-1].content)
        context = {item["description"]: item["value"] for item in sent["context"]}
        assert json.loads(context["task"]) == {
            "id": task["id"],
            "title": "Draft the release notes",
            "instructions": "Use this thread.",
            "priority": "medium",
            "dueAt": None,
        }
        assert any("a task for you" in str(m.get("content")) for m in sent["messages"])

        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "done"
        assert settled.outcome == "Notes: 1.8 shipped with meetups."
        assert settled.completed_at is not None

        # The answer is in the thread, under the hand-off, from the agent.
        async with SessionFactory() as session:
            answer = (
                await session.execute(
                    text(
                        "SELECT body, thread_root_id FROM messages "
                        "WHERE author_id = :bot ORDER BY id DESC LIMIT 1"
                    ),
                    {"bot": desk["bot"]},
                )
            ).fetchone()
        assert answer is not None and answer.body == "Notes: 1.8 shipped with meetups."
        assert str(answer.thread_root_id) == task["threadRootId"]

        # Every change reached the room, so an open thread panel refetches.
        assert [f["status"] for f in desk["frames"] if f["t"] == "task.updated"] == [
            "in_progress",
            "done",
        ]

    async def test_the_hand_off_mentions_the_agent_alone(self, desk: dict[str, Any]) -> None:
        # A name in the task's own text must not notify anybody, or set another agent going.
        created = await handed(
            desk, title="Ask @Member for the numbers", instructions="Ping @Member and @channel."
        )
        assert created.status == 201, created.body
        handoff = await row_of("messages", created.body["task"]["dispatchMessageId"])
        assert [str(u) for u in handoff.mention_user_ids] == [desk["bot"]]
        assert list(handoff.mention_group_ids or []) == []
        assert handoff.mentions_everyone is False

    async def test_a_member_may_hand_work_to_the_workspaces_agent(
        self, desk: dict[str, Any]
    ) -> None:
        # "Only admins can assign work directly to an agent" predates agents having
        # owners. A member who may set the agent going with a mention may hand it a task.
        created = await handed(desk, by=desk["member"])
        assert created.status == 201, created.body
        assert created.body["task"]["status"] == "in_progress"
        handoff = await row_of("messages", created.body["task"]["dispatchMessageId"])
        assert str(handoff.author_id) == desk["member"].user_id

    async def test_nobody_hands_work_to_somebody_elses_agent_not_even_an_admin(
        self, desk: dict[str, Any]
    ) -> None:
        await own(desk, desk["member"].user_id)
        tasks_before = await count("agent_tasks")
        messages_before = await count("messages")

        refused = await handed(desk, by=desk["owner"])
        assert refused.status == 403, refused.body
        assert refused.body["error"]["message"] == "Helper isn't yours to hand work to here."
        assert await count("agent_tasks") == tasks_before
        # The thread's root was sent; nothing else was.
        assert await count("messages") == messages_before + 1

        mine = await handed(desk, by=desk["member"])
        assert mine.status == 201, mine.body

    async def test_an_agent_that_is_not_in_the_channel_is_refused_with_the_reason(
        self, desk: dict[str, Any]
    ) -> None:
        made = await desk["owner"].post("/api/channels", {"name": "launch", "kind": "public"})
        elsewhere = made.body["channel"]["id"]
        tasks_before = await count("agent_tasks")

        refused = await handed(desk, where=elsewhere)
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "agent_not_in_channel"
        assert (
            refused.body["error"]["message"] == "Helper isn't in this channel. Add it here first."
        )
        assert await count("agent_tasks") == tasks_before

    async def test_agents_switched_off_refuse_the_hand_off_up_front(
        self, desk: dict[str, Any]
    ) -> None:
        switched = await desk["owner"].patch(
            "/api/admin/settings", {"settings": {"agentsEnabled": False}}
        )
        assert switched.status == 200, switched.body
        tasks_before = await count("agent_tasks")

        refused = await handed(desk)
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "agents_disabled"
        assert await count("agent_tasks") == tasks_before

    async def test_a_task_for_a_person_hands_nothing_over(self, desk: dict[str, Any]) -> None:
        created = await handed(desk, assignee=desk["member"].user_id)
        assert created.status == 201, created.body
        assert created.body["task"]["status"] == "todo"
        assert created.body["task"]["dispatchMessageId"] is None
        assert not [job for job in desk["enqueued"] if job[0] == "agui_run"]


class TestHowTheRunEndingMovesTheTask:
    async def test_a_failure_blocks_it_with_the_reason(self, desk: dict[str, Any]) -> None:
        task = (await handed(desk)).body["task"]
        await run_handoff(
            desk,
            task,
            frame(type="RUN_STARTED", threadId="t", runId="r")
            + frame(type="RUN_ERROR", message="model unavailable"),
        )
        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "blocked"
        assert settled.outcome == "Helper could not finish: model unavailable"
        assert settled.completed_at is None

    async def test_a_question_keeps_it_in_progress_and_nobody_answering_blocks_it(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        await run_handoff(desk, task, STOPS_TO_ASK)
        assert (await row_of("agent_tasks", task["id"])).status == "in_progress"

        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    "UPDATE agent_runs SET expires_at = now() - interval '1 minute' "
                    "WHERE plugin_id = :p"
                ),
                {"p": desk["plugin_id"]},
            )
        assert await agui_job.expire_agent_decisions() == 1

        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "blocked"
        assert settled.outcome == "Nobody answered Helper's question in time."

    async def test_the_answer_to_its_question_resumes_it_and_the_resume_closes_it(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        await run_handoff(desk, task, STOPS_TO_ASK)
        async with SessionFactory() as session:
            run = (
                await session.execute(
                    text("SELECT id, decision_message_id FROM agent_runs WHERE plugin_id = :p"),
                    {"p": desk["plugin_id"]},
                )
            ).one()

        pressed = await desk["owner"].post(
            "/api/interactions",
            {
                "messageId": str(run.decision_message_id),
                "actionId": f"agent_answer:{run.id}:0",
                "value": "",
                "clientActionId": "yes-1",
            },
        )
        assert pressed.status == 200, pressed.body
        [(answer_id, parent_run_id)] = [
            job[1:] for job in desk["enqueued"] if job[0] == "agui_run" and len(job) == 3
        ]
        desk["state"]["scripts"] = [says("Notes, with the risks.")]
        await agui_job.handle_agui_run(answer_id, parent_run_id)

        # The resume is on the hand-off's chain, so it is told the task and it settles it.
        resumed = json.loads(desk["state"]["seen"][-1].content)
        assert "task" in {item["description"] for item in resumed["context"]}
        settled = await row_of("agent_tasks", task["id"])
        assert (settled.status, settled.outcome) == ("done", "Notes, with the risks.")

    async def test_agents_switched_off_block_it_rather_than_leave_it_waiting(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        switched = await desk["owner"].patch(
            "/api/admin/settings", {"settings": {"agentsEnabled": False}}
        )
        assert switched.status == 200, switched.body

        await run_handoff(desk, task, says("never sent"))

        assert desk["state"]["seen"] == []
        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "blocked"
        assert settled.outcome == "Helper did not run: Agents are turned off for this server."

    async def test_a_person_who_decided_first_is_not_overwritten(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        closed = await desk["owner"].patch(
            f"/api/tasks/{task['id']}", {"status": "done", "outcome": "Did it myself."}
        )
        assert closed.status == 200, closed.body

        await run_handoff(desk, task, says("Here they are."))

        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "done"
        assert settled.outcome == "Did it myself."

    async def test_a_task_that_changed_hands_is_not_settled_by_the_old_run(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        moved = await desk["owner"].patch(
            f"/api/tasks/{task['id']}", {"assigneeUserId": desk["member"].user_id}
        )
        assert moved.status == 200, moved.body
        assert moved.body["task"]["dispatchMessageId"] is None

        await run_handoff(desk, task, says("Here they are."))

        sent = json.loads(desk["state"]["seen"][-1].content)
        assert "task" not in {item["description"] for item in sent["context"]}
        settled = await row_of("agent_tasks", task["id"])
        assert settled.status == "in_progress"
        assert settled.outcome is None
        assert str(settled.assignee_user_id) == desk["member"].user_id

    async def test_saving_a_task_that_already_sits_with_the_agent_hands_nothing_over(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk)).body["task"]
        messages_before = await count("messages")
        runs_before = [job for job in desk["enqueued"] if job[0] == "agui_run"]

        saved = await desk["owner"].patch(
            f"/api/tasks/{task['id']}", {"priority": "high", "assigneeUserId": desk["bot"]}
        )
        assert saved.status == 200, saved.body
        assert saved.body["task"]["dispatchMessageId"] == task["dispatchMessageId"]
        assert await count("messages") == messages_before
        assert [job for job in desk["enqueued"] if job[0] == "agui_run"] == runs_before

    async def test_moving_a_blocked_task_back_to_in_progress_hands_it_over_again(
        self, desk: dict[str, Any]
    ) -> None:
        # The retry. Saving the same assignee hands nothing over, and the task's assignee
        # cannot be cleared through this route, so without this a task its agent's run
        # blocked was a dead end.
        task = (await handed(desk)).body["task"]
        await run_handoff(
            desk,
            task,
            frame(type="RUN_STARTED", threadId="t", runId="r")
            + frame(type="RUN_ERROR", message="model unavailable"),
        )
        assert (await row_of("agent_tasks", task["id"])).status == "blocked"

        again = await desk["owner"].patch(f"/api/tasks/{task['id']}", {"status": "in_progress"})
        assert again.status == 200, again.body
        retried = again.body["task"]
        assert retried["dispatchMessageId"] not in (None, task["dispatchMessageId"])
        assert ("agui_run", retried["dispatchMessageId"]) in desk["enqueued"]

        await run_handoff(desk, retried, says("Second time lucky."))
        settled = await row_of("agent_tasks", task["id"])
        assert (settled.status, settled.outcome) == ("done", "Second time lucky.")

    async def test_a_retry_decides_from_the_task_as_it_stands_when_its_turn_comes(
        self, desk: dict[str, Any]
    ) -> None:
        # The retry pressed in two tabs. Each save decided from the row it had read, so
        # two that read the same blocked row both handed the task over — the agent asked
        # to do the same work twice, in two chains (review of phase 3). The row is locked
        # now. Here the "first tab" is this transaction: it holds the row while the retry
        # arrives, moves the task on, and commits; the retry must then see it moved.
        task = (await handed(desk)).body["task"]
        await run_handoff(
            desk,
            task,
            frame(type="RUN_STARTED", threadId="t", runId="r")
            + frame(type="RUN_ERROR", message="model unavailable"),
        )

        async with transaction() as (session, _after):
            await agentic_service.get_task(session, task["id"], for_update=True)
            retry = asyncio.ensure_future(
                desk["owner"].patch(f"/api/tasks/{task['id']}", {"status": "in_progress"})
            )
            await asyncio.sleep(0.3)
            assert not retry.done()  # It waits for the save already deciding.
            await session.execute(
                text("UPDATE agent_tasks SET status = 'in_progress' WHERE id = :id"),
                {"id": task["id"]},
            )
        retried = await retry

        assert retried.status == 200, retried.body
        # Not handed over a second time: the retry found the task already in progress.
        assert retried.body["task"]["dispatchMessageId"] == task["dispatchMessageId"]

    async def test_a_finished_task_moved_back_to_in_progress_hands_nothing_over(
        self, desk: dict[str, Any]
    ) -> None:
        # Reopening finished work is a person's decision about the task. A save carrying
        # a stale "in progress" — a card edited before the agent finished — must not set
        # the agent going on it again.
        task = (await handed(desk)).body["task"]
        await run_handoff(desk, task, says("All done."))
        assert (await row_of("agent_tasks", task["id"])).status == "done"
        runs_before = [job for job in desk["enqueued"] if job[0] == "agui_run"]

        reopened = await desk["owner"].patch(f"/api/tasks/{task['id']}", {"status": "in_progress"})
        assert reopened.status == 200, reopened.body
        assert reopened.body["task"]["dispatchMessageId"] == task["dispatchMessageId"]
        assert [job for job in desk["enqueued"] if job[0] == "agui_run"] == runs_before

    async def test_in_progress_on_a_persons_task_hands_nothing_over(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk, assignee=desk["member"].user_id)).body["task"]
        moved = await desk["member"].patch(f"/api/tasks/{task['id']}", {"status": "in_progress"})
        assert moved.status == 200, moved.body
        assert moved.body["task"]["dispatchMessageId"] is None
        assert not [job for job in desk["enqueued"] if job[0] == "agui_run"]

    async def test_handing_it_back_from_a_person_starts_a_new_hand_off(
        self, desk: dict[str, Any]
    ) -> None:
        task = (await handed(desk, assignee=desk["member"].user_id)).body["task"]
        assert task["dispatchMessageId"] is None

        moved = await desk["member"].patch(
            f"/api/tasks/{task['id']}", {"assigneeUserId": desk["bot"]}
        )
        assert moved.status == 200, moved.body
        handed_over = moved.body["task"]
        assert handed_over["status"] == "in_progress"
        assert handed_over["dispatchMessageId"]
        handoff = await row_of("messages", handed_over["dispatchMessageId"])
        assert str(handoff.author_id) == desk["member"].user_id

        await run_handoff(desk, handed_over, says("Done and dusted."))
        settled = await row_of("agent_tasks", task["id"])
        assert (settled.status, settled.outcome) == ("done", "Done and dusted.")


class TestAnArchivedChannel:
    async def test_takes_no_new_task_and_no_change_to_one(self, desk: dict[str, Any]) -> None:
        # Read-only means read-only: the person's task routes were the one write here that
        # skipped the archived check (review of 2026-10-05, §3).
        made = await desk["owner"].post("/api/channels", {"name": "shelved", "kind": "public"})
        shelved = made.body["channel"]["id"]
        before = await handed(desk, where=shelved, assignee=desk["member"].user_id)
        assert before.status == 201, before.body
        task = before.body["task"]
        archived = await desk["owner"].post(f"/api/channels/{shelved}/archive", {})
        assert archived.status == 200, archived.body

        refused = await desk["owner"].post(
            f"/api/threads/{task['threadRootId']}/tasks", {"title": "One more"}
        )
        assert refused.status == 403, refused.body
        assert refused.body["error"]["message"] == "This channel is archived and read-only."
        unchanged = await desk["owner"].patch(f"/api/tasks/{task['id']}", {"status": "done"})
        assert unchanged.status == 403, unchanged.body
