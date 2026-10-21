"""Voice messages get their words (M3 · B2): the speech service's transcript becomes the
message's body — for search, for a notification, for an agent — and the agent run a voice
message would start waits for those words, since before them there is nothing to read.
When there will be none, the agent whose DM it is still hears that a recording came.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs.transcribe import handle_transcribe
from blob_api.lib import stt
from blob_api.lib.times import clock_length
from blob_api.plugins.agui import _with_attachment_line
from blob_api.realtime import hub
from blob_api.schemas.models import Attachment, Message
from blob_api.services.mcp import _body

from .helpers import Client, send_message, workspace_id_of
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import desk_fixture  # noqa: F401 — the fake agent and its room
from .test_voice_uploads import _plant_voice

#: The real class, before the agent fixture swaps httpx's for one that answers as the agent.
REAL_CLIENT = httpx.AsyncClient
SAID = "Ship it on Thursday, and tell the client."


@pytest.fixture
def speech(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A speech service that hears `SAID` (or fails, when told to), and storage that holds
    a recording for every key."""
    state: dict[str, Any] = {"requests": [], "fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if state["fail"]:
            return httpx.Response(503, json={"error": "busy"})
        return httpx.Response(200, json={"text": f"  {SAID}  "})

    monkeypatch.setattr(settings, "STT_BASE_URL", "https://stt.example.com/v1")
    monkeypatch.setattr(settings, "STT_API_KEY", "stt-key")
    monkeypatch.setattr(
        stt, "open_client", lambda: REAL_CLIENT(transport=httpx.MockTransport(handler))
    )

    async def recording(_key: str, *, max_bytes: int) -> bytes:
        return b"\x1a\x45\xdf\xa3 pretend opus"

    monkeypatch.setattr("blob_api.lib.storage.get_object", recording)
    return state


async def voice_note(person: Client, channel_id: str, workspace_id: str) -> str:
    attachment_id, _key = await _plant_voice(workspace_id, person.user_id)
    sent = await send_message(person, channel_id, "", attachmentIds=[attachment_id])
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def status_of(message_id: str) -> tuple[str, str | None, str]:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT a.transcript_status, a.transcript_provider, m.body
                      FROM attachments a JOIN messages m ON m.id = a.message_id
                     WHERE m.id = :id
                    """
                ),
                {"id": message_id},
            )
        ).one()
    return row.transcript_status, row.transcript_provider, row.body


async def agent_dm(desk: dict[str, Any]) -> str:
    """A DM with the agent, which — like the resident agent — answers there without an @."""
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE plugins SET answers_dm_without_mention = true WHERE id = :id"),
            {"id": desk["plugin_id"]},
        )
    opened = await desk["owner"].post("/api/dms", {"userIds": [desk["bot"]]})
    assert opened.status == 200, opened.body
    return str(opened.body["channel"]["id"])


class TestTranscripts:
    async def test_the_words_become_the_message(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        assert ("transcribe", message_id) in desk["enqueued"]
        assert (await status_of(message_id))[0] == "pending"

        await handle_transcribe(message_id)
        assert await status_of(message_id) == ("done", "stt:gpt-4o-mini-transcribe", SAID)
        request = speech["requests"][-1]
        assert str(request.url) == "https://stt.example.com/v1/audio/transcriptions"
        assert request.headers["authorization"] == "Bearer stt-key"
        assert b'name="model"' in request.content and b"gpt-4o-mini-transcribe" in request.content

        # Search finds what was said.
        found = (await desk["owner"].get("/api/search?q=Thursday")).body["messages"]
        assert [m["id"] for m in found] == [message_id]

    async def test_an_agent_in_a_dm_hears_it_once_there_are_words(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        ws = await workspace_id_of(desk["owner"])
        dm = await agent_dm(desk)
        message_id = await voice_note(desk["owner"], dm, ws)
        assert ("agui_run", message_id) not in desk["enqueued"], "nothing to read yet"
        await handle_transcribe(message_id)
        assert ("agui_run", message_id) in desk["enqueued"]

    async def test_a_failure_says_so_and_the_agent_hears_what_it_could_not_read(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        """Silence from the agent would read as being ignored; told a recording came that
        nobody could transcribe, it can ask for it typed."""
        speech["fail"] = True
        ws = await workspace_id_of(desk["owner"])
        dm = await agent_dm(desk)
        message_id = await voice_note(desk["owner"], dm, ws)
        await handle_transcribe(message_id)
        assert await status_of(message_id) == ("failed", None, "")
        assert ("agui_run", message_id) in desk["enqueued"]

    async def test_a_follower_hears_the_words(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        followed = await desk["owner"].put(
            f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}"
        )
        assert followed.status == 200, followed.body
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        assert ("agui_run", message_id) not in desk["enqueued"], "nothing to read yet"
        await handle_transcribe(message_id)
        assert ("agui_run", message_id) in desk["enqueued"]

    async def test_a_follower_is_not_woken_for_a_recording_it_cannot_read(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        """Nobody addressed it, so there is nobody to tell that it could not listen."""
        speech["fail"] = True
        followed = await desk["owner"].put(
            f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}"
        )
        assert followed.status == 200, followed.body
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        await handle_transcribe(message_id)
        assert ("agui_run", message_id) not in desk["enqueued"]

    async def test_it_happens_once(self, desk: dict[str, Any], speech: dict[str, Any]) -> None:
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        await handle_transcribe(message_id)
        await handle_transcribe(message_id)
        assert len(speech["requests"]) == 1

    async def test_the_room_is_told_when_the_words_arrive(
        self, desk: dict[str, Any], speech: dict[str, Any]
    ) -> None:
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        desk["frames"].clear()
        await handle_transcribe(message_id)
        updated = [f for f in desk["frames"] if f.get("t") == "message.updated"]
        assert updated and updated[-1]["message"]["body"] == SAID


class TestWithoutASpeechService:
    async def test_a_voice_message_is_only_the_recording(self, desk: dict[str, Any]) -> None:
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        assert (await status_of(message_id))[0] == "none"
        assert ("transcribe", message_id) not in desk["enqueued"]
        boot = (await desk["owner"].get("/api/bootstrap")).body
        assert boot["transcriptionEnabled"] is False

    async def test_the_agent_in_a_dm_hears_one_came_at_once(self, desk: dict[str, Any]) -> None:
        """No words are coming, so there is nothing to wait for."""
        ws = await workspace_id_of(desk["owner"])
        dm = await agent_dm(desk)
        message_id = await voice_note(desk["owner"], dm, ws)
        assert ("agui_run", message_id) in desk["enqueued"]

    async def test_a_follower_hears_nothing(self, desk: dict[str, Any]) -> None:
        followed = await desk["owner"].put(
            f"/api/admin/plugins/{desk['plugin_id']}/follows/{desk['general']}"
        )
        assert followed.status == 200, followed.body
        ws = await workspace_id_of(desk["owner"])
        message_id = await voice_note(desk["owner"], desk["general"], ws)
        assert ("agui_run", message_id) not in desk["enqueued"]


def _message(body: str, *attachments: Attachment) -> Message:
    return Message.model_validate(
        {
            "id": "m1",
            "channelId": "c1",
            "authorId": "u1",
            "body": body,
            "clientMsgId": "c1",
            "createdAt": "2026-10-21T09:00:00+00:00",
            "attachments": list(attachments),
        }
    )


def _voice(status: str) -> Attachment:
    return Attachment(
        id="a1",
        filename="voice-note.webm",
        mime="audio/webm",
        size_bytes=4096,
        url="/api/files/a1",
        kind="voice",
        duration_ms=42_000,
        transcript_status=status,  # type: ignore[arg-type]
    )


class TestWhatAnAgentIsGiven:
    def test_words_that_became_the_message_are_not_named_again(self) -> None:
        assert _with_attachment_line(_message(SAID, _voice("done"))) == SAID

    def test_a_recording_without_its_words_is_named(self) -> None:
        assert (
            _with_attachment_line(_message("", _voice("none")))
            == "[attached: voice message 0:42 (not transcribed)]"
        )
        assert (
            _with_attachment_line(_message("", _voice("failed")))
            == "[attached: voice message 0:42 (not transcribed)]"
        )
        assert (
            _with_attachment_line(_message("", _voice("pending")))
            == "[attached: voice message 0:42 (still being transcribed)]"
        )

    def test_typed_words_keep_the_recording_beside_them(self) -> None:
        pdf = Attachment(
            id="a2", filename="plan.pdf", mime="application/pdf", size_bytes=10, url="/f/a2"
        )
        assert (
            _with_attachment_line(_message("see this", pdf, _voice("none")))
            == "see this\n[attached: plan.pdf, voice message 0:42 (not transcribed)]"
        )


class TestWhatAnAssistantReads:
    """Over `/api/mcp` a recording is named, never by a file name `read_file` refuses."""

    def test_a_recording_is_named_beside_its_words(self) -> None:
        assert _body(_message(SAID, _voice("done"))) == f"{SAID}  [voice message 0:42]"

    def test_one_without_words_says_so(self) -> None:
        assert (
            _body(_message("", _voice("none")))
            == "(no text)  [voice message 0:42 (not transcribed)]"
        )


def test_a_length_reads_the_way_a_player_shows_it() -> None:
    """A push sent before the words exist, and an agent given none, both say how long."""
    assert clock_length(42_000) == "0:42"
    assert clock_length(125_400) == "2:05"
    assert clock_length(200) == "0:01"


def test_the_endpoint_takes_a_base_with_or_without_v1(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "STT_BASE_URL", "http://speaches:8000")
    assert stt._endpoint() == "http://speaches:8000/v1/audio/transcriptions"
    monkeypatch.setattr(settings, "STT_BASE_URL", "https://api.openai.com/v1/")
    assert stt._endpoint() == "https://api.openai.com/v1/audio/transcriptions"


async def test_bootstrap_says_when_there_is_a_speech_service(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    from .helpers import sign_up

    monkeypatch.setattr(settings, "STT_BASE_URL", "https://stt.example.com")
    owner = await sign_up(client, "Owner")
    assert (await owner.get("/api/bootstrap")).body["transcriptionEnabled"] is True
    _ = hub  # imported for the frames the desk records
