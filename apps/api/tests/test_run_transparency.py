"""Watching a run, and answering one (agentic plan, phase 4).

A run used to be a spinner and then an answer. These pin what a person can now see of it
and do with it: the card keeps no draft of an answer once the answer is posted; a run
remembers what it was shown — counts and names, never content; the question a run stops
to ask names the person it waits on, reaches them as a mention, and can be answered from
the card with the choice the agent offered; and a conversation's or an agent's runs can be
paged back through, by whoever can see the conversations they ran in.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job

from .helpers import send_message
from .test_agent_tools import allow, says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
)
from .test_task_dispatch import desk_fixture, row_of  # noqa: F401 — registers `desk`


def stops_to_ask(schema: dict[str, Any], prompt: str = "Which release?") -> bytes:
    return b"".join(
        (
            frame(type="RUN_STARTED", threadId="t", runId="r"),
            frame(
                type="RUN_FINISHED",
                outcome={
                    "type": "interrupt",
                    "interrupts": [{"id": "i1", "message": prompt, "responseSchema": schema}],
                },
            ),
        )
    )


WHICH_RELEASE = stops_to_ask(
    {
        "oneOf": [
            {"const": "a", "title": "Release A"},
            {"const": "b", "title": "Release B"},
        ]
    }
)


async def ask(desk: dict[str, Any], body: str, *scripts: bytes, **extra: Any) -> str:
    desk["state"]["scripts"] = list(scripts)
    sent = await send_message(desk["owner"], extra.pop("where", desk["general"]), body, **extra)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


async def the_run(desk: dict[str, Any]) -> dict[str, Any]:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    "SELECT * FROM agent_runs WHERE plugin_id = :p "
                    "ORDER BY started_at DESC, id DESC LIMIT 1"
                ),
                {"p": desk["plugin_id"]},
            )
        ).fetchone()
    assert row is not None
    return dict(row._mapping)


async def view_of(desk: dict[str, Any], run_id: str) -> dict[str, Any]:
    listed = (await desk["owner"].get(f"/api/channels/{desk['general']}/agent-runs")).body
    [view] = [run for run in listed["runs"] if run["id"] == run_id]
    return view


class TestTheDraft:
    async def test_the_card_the_row_keeps_has_no_draft_of_the_answer(
        self, desk: dict[str, Any]
    ) -> None:
        script = b"".join(
            (
                frame(type="RUN_STARTED", threadId="t", runId="r"),
                frame(type="STEP_STARTED", stepName="read the thread"),
                frame(type="TEXT_MESSAGE_START", messageId="m", role="assistant"),
                frame(type="TEXT_MESSAGE_CONTENT", messageId="m", delta="Here it is."),
                frame(type="TEXT_MESSAGE_END", messageId="m"),
                frame(type="STEP_FINISHED", stepName="read the thread"),
                frame(type="RUN_FINISHED", threadId="t", runId="r"),
            )
        )
        await ask(desk, "@Helper go", script)

        run = await the_run(desk)
        assert run["status"] == "succeeded"
        assert run["card"]["steps"] == [{"name": "read the thread", "status": "done"}]
        assert run["card"]["textTail"] is None
        # And the room's last word on the card has no draft either: the answer is posted.
        snapshots = [
            f["card"]
            for f in desk["frames"]
            if f["t"] == "agent_run.updated" and f["runId"] == str(run["id"])
        ]
        assert snapshots and snapshots[-1]["textTail"] is None


class TestWhatARunWasShown:
    async def test_a_run_keeps_counts_and_names_and_no_content(self, desk: dict[str, Any]) -> None:
        root = await send_message(desk["owner"], desk["general"], "We shipped 1.8 today.")
        await ask(
            desk,
            "@Helper what shipped?",
            says("Meetups."),
            threadRootId=root.body["message"]["id"],
        )

        expected = {
            "messages": 2,
            "window": "thread",
            "files": 0,
            "instructions": False,
            "memory": False,
            "task": False,
            "tools": [],
            "protocol": None,
        }
        run = await the_run(desk)
        assert run["seen"] == expected
        listed = (await desk["owner"].get("/api/agent-runs")).body["runs"]
        [view] = [r for r in listed if r["id"] == str(run["id"])]
        assert view["seen"] == expected

    async def test_the_tools_it_was_offered_are_named(self, desk: dict[str, Any]) -> None:
        await allow(desk, "read")
        await ask(desk, "@Helper look around", says("Done."))
        seen = (await the_run(desk))["seen"]
        assert seen["window"] == "channel"
        assert seen["tools"] == [
            "ask_agent",
            "list_agents",
            "list_channels",
            "list_decisions",
            "list_people",
            "list_tasks",
            "read_channel",
            "read_file",
            "read_thread",
            "search_messages",
        ]

    async def test_the_admin_log_drills_into_a_run(self, desk: dict[str, Any]) -> None:
        await ask(desk, "@Helper go", says("Gone."))
        logged = await desk["owner"].get(f"/api/admin/plugins/{desk['plugin_id']}/runs")
        assert logged.status == 200, logged.body
        [run] = logged.body["runs"]
        assert run["seen"]["window"] == "channel"
        assert "card" in run

    async def test_the_admin_log_shows_what_a_run_did_only_where_the_admin_can_see(
        self, desk: dict[str, Any]
    ) -> None:
        # A run's card carries its tool calls' arguments and results — the room's own
        # words. A private room keeps them from an admin who is not in it, as it keeps its
        # messages; that the run happened, and where, the admin still sees, as the
        # console's channel list already names every room (review of phase 4).
        made = await desk["member"].post("/api/channels", {"name": "quiet", "kind": "private"})
        quiet = made.body["channel"]["id"]
        card = {
            "steps": [],
            "tools": [{"name": "read_thread", "status": "done", "args": "{}", "result": "secret"}],
            "activity": None,
            "reasoning": None,
            "textChars": 0,
            "dropped": 0,
        }
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO agent_runs
                        (id, workspace_id, plugin_id, channel_id, transport, status,
                         chain_id, card, finished_at)
                    VALUES (:id, (SELECT workspace_id FROM plugins WHERE id = :p), :p, :c,
                            'http', 'succeeded', :id, cast(:card AS jsonb), now())
                    """
                ),
                {
                    "id": "01a22222-2222-7222-8222-222222222222",
                    "p": desk["plugin_id"],
                    "c": quiet,
                    "card": json.dumps(card),
                },
            )
        await ask(desk, "@Helper go", says("Gone."))

        logged = (await desk["owner"].get(f"/api/admin/plugins/{desk['plugin_id']}/runs")).body
        by_channel = {run["channelId"]: run for run in logged["runs"]}
        assert by_channel[quiet]["channelName"] == "quiet"
        assert by_channel[quiet]["card"] is None
        assert by_channel[desk["general"]]["seen"] is not None


class TestAQuestionWaitingOnSomebody:
    async def test_it_names_the_person_it_waits_on_and_reaches_them(
        self, desk: dict[str, Any]
    ) -> None:
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run = await the_run(desk)
        question = await row_of("messages", str(run["decision_message_id"]))
        assert question.body.startswith("Needs a decision from @Owner: Which release?")
        assert [str(u) for u in question.mention_user_ids] == [desk["owner"].user_id]

    async def test_the_card_carries_the_question_and_its_choices(
        self, desk: dict[str, Any]
    ) -> None:
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run = await the_run(desk)
        view = await view_of(desk, str(run["id"]))
        assert view["decision"] == {
            "prompt": "Which release?",
            "choices": [{"label": "Release A"}, {"label": "Release B"}],
            "freeText": False,
        }

    async def test_the_asker_answers_from_the_card_with_the_choice_offered(
        self, desk: dict[str, Any]
    ) -> None:
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run_id = str((await the_run(desk))["id"])

        answered = await desk["owner"].post(
            f"/api/agent-runs/{run_id}/answer", {"choice": 1, "clientActionId": "pick-b"}
        )
        assert answered.status == 200, answered.body
        [(answer_id, parent)] = [
            job[1:] for job in desk["enqueued"] if job[0] == "agui_run" and len(job) == 3
        ]
        assert parent == run_id
        assert (await row_of("messages", answer_id)).body == "Release B"

        desk["state"]["scripts"] = [says("Release B it is.")]
        await agui_job.handle_agui_run(answer_id, parent)
        resumed = json.loads(desk["state"]["seen"][-1].content)
        # The agent gets the value it declared, not the label the channel read.
        assert resumed["resume"] == [{"interruptId": "i1", "status": "resolved", "payload": "b"}]

        again = await desk["owner"].post(
            f"/api/agent-runs/{run_id}/answer", {"choice": 0, "clientActionId": "pick-a"}
        )
        assert again.status == 409, again.body

    async def test_a_choice_not_on_offer_is_refused(self, desk: dict[str, Any]) -> None:
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run_id = str((await the_run(desk))["id"])
        refused = await desk["owner"].post(f"/api/agent-runs/{run_id}/answer", {"choice": 5})
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "unknown_action"

    async def test_words_are_not_an_answer_to_a_question_that_offered_choices(
        self, desk: dict[str, Any]
    ) -> None:
        # The agent declared what it can take. A sentence handed back where it expected
        # "a" or "b" — or a boolean — is an answer it never offered.
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run_id = str((await the_run(desk))["id"])
        refused = await desk["owner"].post(
            f"/api/agent-runs/{run_id}/answer", {"value": "Whichever is newer"}
        )
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "choice_required"

    async def test_an_answer_is_a_choice_or_words_and_not_both(self, desk: dict[str, Any]) -> None:
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run_id = str((await the_run(desk))["id"])
        both = await desk["owner"].post(
            f"/api/agent-runs/{run_id}/answer", {"choice": 0, "value": "A"}
        )
        neither = await desk["owner"].post(f"/api/agent-runs/{run_id}/answer", {})
        assert (both.status, neither.status) == (400, 400)

    async def test_a_question_without_choices_takes_words_and_only_words(
        self, desk: dict[str, Any]
    ) -> None:
        await ask(desk, "@Helper when?", stops_to_ask({"type": "string"}, "When should it ship?"))
        run_id = str((await the_run(desk))["id"])
        view = await view_of(desk, run_id)
        assert view["decision"] == {
            "prompt": "When should it ship?",
            "choices": [],
            "freeText": True,
        }
        refused = await desk["owner"].post(f"/api/agent-runs/{run_id}/answer", {"choice": 0})
        assert refused.status == 400, refused.body
        answered = await desk["owner"].post(
            f"/api/agent-runs/{run_id}/answer", {"value": "Next Tuesday"}
        )
        assert answered.status == 200, answered.body

    async def test_nobody_else_sees_a_choice_they_could_make(self, desk: dict[str, Any]) -> None:
        # The card is the room's, and the question with it — it is posted in the channel
        # anyway. Who may answer is the private thing, and the route keeps it.
        await ask(desk, "@Helper draft the notes", WHICH_RELEASE)
        run_id = str((await the_run(desk))["id"])
        refused = await desk["member"].post(f"/api/agent-runs/{run_id}/answer", {"choice": 0})
        assert refused.status == 403, refused.body


class TestRunHistory:
    async def test_a_conversations_runs_page_back_newest_first(self, desk: dict[str, Any]) -> None:
        for n in range(3):
            await ask(desk, f"@Helper number {n}", says(f"Answer {n}."))

        first = await desk["owner"].get(
            f"/api/agent-runs/history?channelId={desk['general']}&limit=2"
        )
        assert first.status == 200, first.body
        assert [r["status"] for r in first.body["runs"]] == ["succeeded", "succeeded"]
        assert first.body["nextBefore"] == first.body["runs"][-1]["id"]
        newest_first = [r["id"] for r in first.body["runs"]]
        assert newest_first == sorted(newest_first, reverse=True)

        rest = await desk["owner"].get(
            f"/api/agent-runs/history?channelId={desk['general']}&limit=2"
            f"&before={first.body['nextBefore']}"
        )
        assert rest.status == 200, rest.body
        assert len(rest.body["runs"]) == 1
        assert rest.body["nextBefore"] is None

    async def test_an_agents_runs_are_the_ones_in_conversations_you_can_see(
        self, desk: dict[str, Any]
    ) -> None:
        made = await desk["owner"].post("/api/channels", {"name": "board", "kind": "private"})
        board = made.body["channel"]["id"]
        joined = await desk["owner"].post(
            f"/api/admin/plugins/{desk['plugin_id']}/channels/{board}", {}
        )
        assert joined.status < 400, joined.body
        await ask(desk, "@Helper in public", says("Public."))
        await ask(desk, "@Helper in private", says("Private."), where=board)

        mine = await desk["member"].get(f"/api/agent-runs/history?pluginId={desk['plugin_id']}")
        assert mine.status == 200, mine.body
        assert {r["channelId"] for r in mine.body["runs"]} == {desk["general"]}

        theirs = await desk["owner"].get(f"/api/agent-runs/history?pluginId={desk['plugin_id']}")
        assert {r["channelId"] for r in theirs.body["runs"]} == {desk["general"], board}

    async def test_a_private_conversation_you_are_not_in_has_no_history_to_show(
        self, desk: dict[str, Any]
    ) -> None:
        made = await desk["owner"].post("/api/channels", {"name": "board", "kind": "private"})
        board = made.body["channel"]["id"]
        hidden = await desk["member"].get(f"/api/agent-runs/history?channelId={board}")
        assert hidden.status == 404, hidden.body

    async def test_an_agent_can_be_named_by_the_member_it_is(self, desk: dict[str, Any]) -> None:
        # What a client that talks to the agent knows it by — its DM is with a member.
        await ask(desk, "@Helper hello", says("Hello."))
        by_member = await desk["owner"].get(f"/api/agent-runs/history?agentUserId={desk['bot']}")
        assert by_member.status == 200, by_member.body
        assert [r["agentName"] for r in by_member.body["runs"]] == ["Helper"]

        a_person = await desk["owner"].get(
            f"/api/agent-runs/history?agentUserId={desk['member'].user_id}"
        )
        assert a_person.status == 404, a_person.body

    async def test_history_needs_a_conversation_or_an_agent(self, desk: dict[str, Any]) -> None:
        refused = await desk["owner"].get("/api/agent-runs/history")
        assert refused.status == 400, refused.body
