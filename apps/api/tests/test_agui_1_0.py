"""AG-UI 1.0: what an agent says it speaks, and what follows from it.

The protocol froze at 1.0 on 2026-09-30, backwards compatible but with a catch on the
input side: Python agents built on SDKs up to 0.1.9 refuse any input member they do not
know, so `protocolVersion` — and content parts where they expect text — would be a 422
that looks exactly like the agent being down. The spec's answer is that an agent states
its own version in `RUN_STARTED.protocolVersion`, and a client omits the field for a peer
it knows predates it. These pin Blob doing that: learning the version from the first run,
speaking 1.0 only to an agent that said so, and taking what 1.0 adds on the way back —
token usage, a run the agent cancelled itself, several questions at once.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.lib.ids import new_id
from blob_api.plugins import agui
from blob_api.schemas.models import Attachment, Message

from .helpers import send_message
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    agent_speaks,
    frame,
    install,
    join_channel,
    route_agent_to,
)
from .test_agui import team as _team_fixture
from .test_thumbnails import a_png, storage_is_up, upload

team = _team_fixture


def opening(version: str | None) -> bytes:
    """A RUN_STARTED that states a version, or one from before the field."""
    if version is None:
        return frame(type="RUN_STARTED", threadId="t", runId="r")
    return frame(type="RUN_STARTED", threadId="t", runId="r", protocolVersion=version)


def answer_as(version: str | None, *, finished: dict[str, Any] | None = None) -> tuple[bytes, ...]:
    return (
        opening(version),
        *ANSWER[1:-1],
        frame(type="RUN_FINISHED", threadId="t", runId="r", **(finished or {})),
    )


async def agui_version_of(plugin_id: str) -> str | None:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT agui_version FROM plugins WHERE id = :id"), {"id": plugin_id}
            )
        ).scalar_one()


def message(id_: str, author: str, body: str, *files: Attachment) -> Message:
    return Message(
        id=id_,
        channel_id="c",
        author_id=author,
        body=body,
        client_msg_id=id_,
        created_at="2026-10-07T10:00:00.000Z",
        attachments=list(files),
    )


def attached(name: str, *, kind: str = "file", transcript: str = "none") -> Attachment:
    return Attachment(
        id=f"a-{name}",
        filename=name,
        mime="application/pdf",
        size_bytes=10,
        url="/x",
        kind=kind,
        transcript_status=transcript,
    )


# ─── as arithmetic ────────────────────────────────────────────────────────────
class TestWhatTheAgentSays:
    def test_an_agent_states_its_version_when_the_run_starts(self) -> None:
        fold = agui.Fold()
        fold.feed({"type": "RUN_STARTED", "threadId": "t", "runId": "r", "protocolVersion": "1.0"})
        assert fold.protocol_version == "1.0"

    def test_a_patch_number_is_accepted_and_dropped(self) -> None:
        # The protocol versions by MAJOR.MINOR; a producer that writes 1.0.3 still speaks 1.0.
        fold = agui.Fold()
        fold.feed({"type": "RUN_STARTED", "protocolVersion": "1.0.3"})
        assert fold.protocol_version == "1.0"
        assert agui.speaks("1.0.3")

    def test_something_that_is_not_a_version_is_not_kept(self) -> None:
        fold = agui.Fold()
        fold.feed({"type": "RUN_STARTED", "protocolVersion": "one point oh"})
        assert fold.protocol_version is None

    def test_versions_compare_as_numbers(self) -> None:
        assert agui.speaks("1.0")
        assert agui.speaks("1.10", "1.9")
        assert not agui.speaks("0.9")
        assert not agui.speaks(None)
        assert not agui.speaks("latest")

    def test_usage_keeps_what_the_protocol_defines(self) -> None:
        fold = agui.Fold()
        fold.feed(
            {
                "type": "RUN_FINISHED",
                "usage": [
                    {"provider": "openai", "model": "gpt", "inputTokens": 120, "outputTokens": 30},
                    {"model": "x", "totalTokens": 50, "secret": "not kept", "inputTokens": True},
                    {"provider": "nothing to count"},
                ],
            }
        )
        assert fold.usage == [
            {"provider": "openai", "model": "gpt", "inputTokens": 120, "outputTokens": 30},
            {"model": "x", "totalTokens": 50},
        ]
        assert agui.total_tokens(fold.usage) == 200

    def test_a_run_the_agent_cancelled_is_said_to_be_cancelled(self) -> None:
        fold = agui.Fold()
        fold.feed({"type": "RUN_FINISHED", "outcome": {"type": "cancelled"}})
        assert fold.cancelled and fold.error is None

    def test_an_error_message_is_kept_short(self) -> None:
        # Stored on the run and broadcast to the channel, so an agent cannot fill either.
        fold = agui.Fold()
        fold.feed({"type": "RUN_ERROR", "message": "x" * 10_000})
        assert fold.error is not None and len(fold.error) == agui.ERROR_MAX_CHARS


class TestWhatTheAgentIsShown:
    def test_a_file_is_named_in_the_text_whatever_the_agent_speaks(self) -> None:
        out = agui.to_agui_messages(
            [
                message("1", "ana", "see the plan", attached("plan.pdf")),
                message("2", "ana", "", attached("chart.pdf")),
                message(
                    "3",
                    "ana",
                    "what I said",
                    attached("memo.webm", kind="voice", transcript="done"),
                ),
            ],
            bot_user_id="bot",
            names={"ana": "Ana"},
        )
        assert [entry["content"] for entry in out] == [
            "see the plan\n[attached: plan.pdf]",
            # A message that was only a file used to be dropped altogether.
            "[attached: chart.pdf]",
            # A voice note's transcript is its body; the recording is not named again (one
            # without its words is — `test_voice_transcripts.TestWhatAnAgentIsGiven`).
            "what I said",
        ]

    def test_parts_ride_on_the_message_they_came_with(self) -> None:
        image = {
            "type": "image",
            "source": {"type": "data", "value": "aGk=", "mimeType": "image/png"},
        }
        out = agui.to_agui_messages(
            [message("1", "ana", "look", attached("a.pdf")), message("2", "bot", "seen")],
            bot_user_id="bot",
            names={"ana": "Ana"},
            parts={"1": [image], "2": [image]},
        )
        assert out[0]["content"] == [{"type": "text", "text": "look\n[attached: a.pdf]"}, image]
        # Never on the agent's own words.
        assert out[1]["content"] == "seen"


class TestSeveralQuestionsAtOnce:
    ITEMS = [
        {"id": "i1", "message": "Deploy?", "responseSchema": {"type": "boolean"}},
        {"id": "i2", "message": "Which region?", "responseSchema": {"enum": ["eu", "us"]}},
    ]

    def test_the_first_question_is_asked_whole(self) -> None:
        # The prompt and the buttons came from different interrupts when the first had no
        # choices; now both come from the first.
        decision = agui.decision_of(self.ITEMS)
        assert decision.prompt == "Deploy?"
        assert [c.value for c in decision.choices] == [True, False]

    def test_the_answer_goes_to_the_question_asked_and_the_rest_are_cancelled(self) -> None:
        entries = agui.resume_entries(agui.decision_of(self.ITEMS).interrupt_ids, True)
        assert entries == [
            {"interruptId": "i1", "status": "resolved", "payload": True},
            {"interruptId": "i2", "status": "cancelled"},
        ]


# ─── the round trip ───────────────────────────────────────────────────────────
class TestSpeakingTheAgentsVersion:
    async def test_the_version_is_learned_from_the_first_run_and_spoken_from_the_next(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*answer_as("1.0"))
        route_agent_to(monkeypatch, transport)

        for body in ("@Helper first", "@Helper second"):
            sent = await send_message(team["owner"], team["general"], body)
            await agui_job.handle_agui_run(sent.body["message"]["id"])

        first, second = (json.loads(request.content) for request in seen)
        assert "protocolVersion" not in first  # Nothing known yet: say nothing new.
        assert second["protocolVersion"] == agui.PROTOCOL_VERSION
        assert await agui_version_of(app_body["plugin"]["id"]) == "1.0"

    async def test_an_agent_that_never_says_is_never_sent_the_field(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*answer_as(None))
        route_agent_to(monkeypatch, transport)

        for body in ("@Helper first", "@Helper second"):
            sent = await send_message(team["owner"], team["general"], body)
            await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert all("protocolVersion" not in json.loads(r.content) for r in seen)
        assert await agui_version_of(app_body["plugin"]["id"]) is None


class TestAnAgentThatGoesBack:
    async def test_a_run_refused_in_1_0_is_sent_in_the_older_shape_next_time(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Declared 1.0, then redeployed on an SDK that refuses unknown fields: it answers
        # the run with a 422 before it can say what it speaks. Remembering 1.0 for ever
        # would make it look down for good.
        app_body = await install(team["owner"])
        plugin_id = app_body["plugin"]["id"]
        await join_channel(team["owner"], app_body, team["general"])
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE plugins SET agui_version = '1.0' WHERE id = :id"),
                    {"id": plugin_id},
                )
        transport, seen = agent_speaks(b"", status=422)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper are you there?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert json.loads(seen[0].content)["protocolVersion"] == agui.PROTOCOL_VERSION
        assert await agui_version_of(plugin_id) is None

    async def test_an_agent_that_never_spoke_1_0_keeps_nothing_to_forget(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(b"", status=422)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert "protocolVersion" not in json.loads(seen[0].content)
        assert await agui_version_of(app_body["plugin"]["id"]) is None


class TestWhatARunCost:
    async def test_reported_usage_is_kept_and_counted(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        usage = [
            {"provider": "anthropic", "model": "claude", "inputTokens": 900, "outputTokens": 100}
        ]
        transport, _ = agent_speaks(*answer_as("1.0", finished={"usage": usage}))
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper what did it cost?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        runs = (await team["owner"].get(f"/api/channels/{team['general']}/agent-runs")).body["runs"]
        assert runs[0]["tokens"] == 1000
        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        mine = next(p for p in listed if p["id"] == app_body["plugin"]["id"])
        assert mine["tokensLastDay"] == 1000
        assert mine["aguiVersion"] == "1.0"
        log = (await team["owner"].get(f"/api/admin/plugins/{app_body['plugin']['id']}/runs")).body[
            "runs"
        ]
        assert log[0]["tokens"] == 1000

    async def test_one_odd_usage_row_cannot_break_the_console(self, team: dict) -> None:
        # The fold stores only whole numbers, but the statement behind the console's list
        # of agents must survive a row written by anything else.
        app_body = await install(team["owner"])
        plugin_id = app_body["plugin"]["id"]
        async with SessionFactory() as session:
            async with session.begin():
                workspace = (
                    await session.execute(
                        text("SELECT workspace_id FROM plugins WHERE id = :id"), {"id": plugin_id}
                    )
                ).scalar_one()
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_runs
                          (id, workspace_id, plugin_id, channel_id, transport, status,
                           chain_id, usage)
                        VALUES (:id, :ws, :p, :c, 'http', 'succeeded', :id,
                                cast(:usage AS jsonb))
                        """
                    ),
                    {
                        "id": new_id(),
                        "ws": workspace,
                        "p": plugin_id,
                        "c": team["general"],
                        "usage": json.dumps(
                            [{"totalTokens": "lots"}, {"inputTokens": 5, "outputTokens": "x"}]
                        ),
                    },
                )

        listed = await team["owner"].get("/api/admin/plugins")
        assert listed.status == 200, listed.body
        mine = next(p for p in listed.body["plugins"] if p["id"] == plugin_id)
        assert mine["tokensLastDay"] == 5

    async def test_a_run_the_agent_cancelled_reads_as_stopped(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(
            opening("1.0"), frame(type="RUN_FINISHED", outcome={"type": "cancelled"})
        )
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper never mind")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        runs = (await team["owner"].get(f"/api/channels/{team['general']}/agent-runs")).body["runs"]
        assert runs[0]["status"] == "cancelled"
        assert runs[0]["error"] is None


class TestShowingReasoning:
    REASONS = (
        opening("1.0"),
        frame(type="REASONING_MESSAGE_CONTENT", messageId="r", delta="checking the plan"),
        *ANSWER[1:],
    )

    async def test_reasoning_stays_off_the_card_until_an_admin_turns_it_on(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        plugin_id = app_body["plugin"]["id"]
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(*self.REASONS)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper think aloud")
        await agui_job.handle_agui_run(sent.body["message"]["id"])
        shown = await team["owner"].post(
            f"/api/admin/plugins/{plugin_id}/reasoning", {"shown": True}
        )
        assert shown.status == 200, shown.body
        assert shown.body["showsReasoning"] is True
        again = await send_message(team["owner"], team["general"], "@Helper once more")
        await agui_job.handle_agui_run(again.body["message"]["id"])

        runs = (await team["owner"].get(f"/api/channels/{team['general']}/agent-runs")).body["runs"]
        by_trigger = {run["triggerMessageId"]: run for run in runs}
        before = by_trigger[sent.body["message"]["id"]]["card"]
        after = by_trigger[again.body["message"]["id"]]["card"]
        assert before is None or before["reasoning"] is None
        assert after is not None and after["reasoning"] == "checking the plan"

    async def test_only_an_admin_may_turn_it_on(self, team: dict) -> None:
        app_body = await install(team["owner"])
        refused = await team["member"].post(
            f"/api/admin/plugins/{app_body['plugin']['id']}/reasoning", {"shown": True}
        )
        assert refused.status == 403


class TestTheFilesInTheConversation:
    async def test_an_agent_that_speaks_1_0_is_handed_the_image_people_shared(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        if not await storage_is_up():
            pytest.skip("object storage is not running — start MinIO to exercise this")
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE plugins SET agui_version = '1.0' WHERE id = :id"),
                    {"id": app_body["plugin"]["id"]},
                )
        png = a_png(40, 30)
        # Uploaded before the agent is routed: the fake replaces httpx's client globally.
        attachment_id = await upload(team["owner"], png, filename="chart.png", mime="image/png")
        transport, seen = agent_speaks(*answer_as("1.0"))
        route_agent_to(monkeypatch, transport)

        sent = await send_message(
            team["owner"],
            team["general"],
            "@Helper what does this chart show?",
            attachmentIds=[attachment_id],
        )
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        content = json.loads(seen[0].content)["messages"][-1]["content"]
        assert content[0] == {
            "type": "text",
            "text": "@Helper what does this chart show?\n[attached: chart.png]",
        }
        assert content[1]["type"] == "image"
        assert content[1]["source"]["mimeType"] == "image/png"
        assert base64.b64decode(content[1]["source"]["value"]) == png

    async def test_an_older_agent_is_told_the_file_exists_and_not_handed_it(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        if not await storage_is_up():
            pytest.skip("object storage is not running — start MinIO to exercise this")
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        attachment_id = await upload(team["owner"], a_png(40, 30), filename="chart.png")
        transport, seen = agent_speaks(*answer_as(None))
        route_agent_to(monkeypatch, transport)

        sent = await send_message(
            team["owner"], team["general"], "@Helper and this?", attachmentIds=[attachment_id]
        )
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        last = json.loads(seen[0].content)["messages"][-1]
        assert last["content"] == "@Helper and this?\n[attached: chart.png]"
