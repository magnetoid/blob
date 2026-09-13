"""A voice message is an attachment that knows it is one.

What separates it from a file upload, and what each of these pins: the ticket refuses a
type that is not audio, the row stores the *bare* mime (the presigned URL pins one
`Content-Type` and the browser has to send the same string back), completion records the
length and the bars, the message payload carries all of it, the Files tab lists voice
apart from files, and the download is served **inline** so `<audio>` can play it — which
an ordinary audio *file* still is not, because that same allowlist decides what may
become somebody's avatar.

The rows are planted or driven through the API without object storage: presigning is
offline math and every decision here is made in Postgres.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id

from .helpers import Client, invite_and_sign_up, send_message, sign_up

#: The EBML header a webm recording opens with.
WEBM_HEAD = b"\x1a\x45\xdf\xa3\x01\x00\x00\x00"


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    workspace_id = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
    channel = (
        await owner.post(
            "/api/channels",
            {"name": "voice-notes", "kind": "private", "memberIds": [member.user_id]},
        )
    ).body["channel"]
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "workspace": workspace_id,
        "channel": channel,
    }


def audio_arrives(monkeypatch: pytest.MonkeyPatch) -> None:
    """`complete` reads the first bytes back to check the type. Say they are webm.

    A plain function, not a fixture: asking for one here reorders the autouse truncate
    against the workspace `team` just built, and the attachment insert then fails on a
    workspace that is no longer there.
    """

    async def head(_key: str, _n: int = 64) -> bytes:
        return WEBM_HEAD

    monkeypatch.setattr("blob_api.routers.files.get_object_head", head)


async def _ticket(client: Client, **overrides: Any) -> Any:
    body = {
        "filename": "voice-2026-09-13.webm",
        "mime": "audio/webm;codecs=opus",
        "sizeBytes": 4096,
        "kind": "voice",
    }
    body.update(overrides)
    return await client.post("/api/uploads", body)


async def _row(attachment_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text(
                    "SELECT kind, mime, duration_ms, waveform, transcript_status,"
                    " transcript_provider, object_key FROM attachments WHERE id = :id"
                ),
                {"id": attachment_id},
            )
        ).fetchone()


async def _plant_voice(
    workspace_id: str, uploader_id: str, *, message_id: str | None = None
) -> tuple[str, str]:
    attachment_id = new_id()
    object_key = f"{workspace_id}/test/{attachment_id}.webm"
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO attachments
                  (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes,
                   message_id, kind, duration_ms, waveform)
                VALUES (:id, :ws, :up, :key, 'voice-note.webm', 'audio/webm', 4096,
                        :message_id, 'voice', 42_000, '[10, 200, 30]'::jsonb)
                """
            ),
            {
                "id": attachment_id,
                "ws": workspace_id,
                "up": uploader_id,
                "key": object_key,
                "message_id": message_id,
            },
        )
    return attachment_id, object_key


class TestTheTicket:
    async def test_a_voice_ticket_refuses_a_type_that_is_not_audio(self, team: dict) -> None:
        response = await _ticket(team["owner"], mime="image/png", filename="shot.png")
        assert response.status == 400, response.body
        assert "audio" in response.body["error"]["message"].lower()

    async def test_it_stores_the_bare_mime_and_the_kind(self, team: dict) -> None:
        """`audio/webm;codecs=opus` is what MediaRecorder reports and what the browser
        would PUT; the presigned URL pins one Content-Type, so both have to be the
        bare type or the upload is refused by object storage."""
        ticket = await _ticket(team["owner"])
        assert ticket.status == 200, ticket.body
        assert ticket.body["headers"]["Content-Type"] == "audio/webm"
        row = await _row(ticket.body["attachmentId"])
        assert row.kind == "voice"
        assert row.mime == "audio/webm"
        assert row.transcript_status == "none"

    async def test_an_ordinary_file_ticket_is_unchanged(self, team: dict) -> None:
        ticket = await team["owner"].post(
            "/api/uploads", {"filename": "notes.pdf", "mime": "application/pdf", "sizeBytes": 10}
        )
        assert ticket.status == 200, ticket.body
        assert (await _row(ticket.body["attachmentId"])).kind == "file"


class TestCompletion:
    async def test_it_records_the_length_and_the_bars(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        audio_arrives(monkeypatch)
        ticket = await _ticket(team["owner"])
        bars = [0, 40, 128, 255, 90, 12, 200, 7]
        done = await team["owner"].post(
            f"/api/uploads/{ticket.body['attachmentId']}/complete",
            {"durationMs": 42_000, "waveform": bars},
        )
        assert done.status == 200, done.body
        row = await _row(ticket.body["attachmentId"])
        assert row.duration_ms == 42_000
        assert row.waveform == bars

    async def test_a_voice_message_without_a_length_is_refused(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        audio_arrives(monkeypatch)
        ticket = await _ticket(team["owner"])
        done = await team["owner"].post(f"/api/uploads/{ticket.body['attachmentId']}/complete")
        assert done.status == 400, done.body
        assert "length" in done.body["error"]["message"].lower()

    async def test_a_bar_outside_a_byte_is_refused(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        audio_arrives(monkeypatch)
        ticket = await _ticket(team["owner"])
        done = await team["owner"].post(
            f"/api/uploads/{ticket.body['attachmentId']}/complete",
            {"durationMs": 1_000, "waveform": [0, 10, 20, 30, 40, 50, 60, 300]},
        )
        assert done.status == 400, done.body
        assert done.body["error"]["code"] == "invalid_input"

    async def test_a_recording_that_is_not_audio_is_refused(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ticket = await _ticket(team["owner"])

        async def html_head(_key: str, _n: int = 64) -> bytes:
            return b"<!DOCTYPE html><html>"

        async def noop_delete(_key: str) -> None:
            return None

        monkeypatch.setattr("blob_api.routers.files.get_object_head", html_head)
        monkeypatch.setattr("blob_api.routers.files.delete_object", noop_delete)
        done = await team["owner"].post(
            f"/api/uploads/{ticket.body['attachmentId']}/complete", {"durationMs": 1_000}
        )
        assert done.status == 400, done.body


class TestWhatTheClientSees:
    async def test_the_message_carries_the_kind_length_and_bars(self, team: dict) -> None:
        attachment_id, _ = await _plant_voice(team["workspace"], team["owner"].user_id)
        sent = await send_message(
            team["owner"], team["channel"]["id"], "", attachmentIds=[attachment_id]
        )
        assert sent.status == 201, sent.body
        attachment = sent.body["message"]["attachments"][0]
        assert attachment["kind"] == "voice"
        assert attachment["durationMs"] == 42_000
        assert attachment["waveform"] == [10, 200, 30]
        assert attachment["transcriptStatus"] == "none"
        assert attachment["transcriptProvider"] is None

    async def test_the_files_tab_lists_voice_apart_from_files(self, team: dict) -> None:
        attachment_id, _ = await _plant_voice(team["workspace"], team["owner"].user_id)
        await send_message(team["owner"], team["channel"]["id"], "", attachmentIds=[attachment_id])

        voice = await team["owner"].get("/api/attachments?kind=voice")
        assert [item["id"] for item in voice.body["items"]] == [attachment_id]

        files = await team["owner"].get("/api/attachments?kind=file")
        assert attachment_id not in [item["id"] for item in files.body["items"]]

        everything = await team["owner"].get("/api/attachments")
        assert attachment_id in [item["id"] for item in everything.body["items"]]

    async def test_an_unknown_kind_is_refused(self, team: dict) -> None:
        assert (await team["owner"].get("/api/attachments?kind=bogus")).status == 400


class TestPlayback:
    async def test_a_voice_message_is_served_inline_as_its_own_type(self, team: dict) -> None:
        """Without this an `<audio src>` downloads the file instead of playing it."""
        attachment_id, key = await _plant_voice(team["workspace"], team["owner"].user_id)
        sent = await send_message(
            team["owner"], team["channel"]["id"], "", attachmentIds=[attachment_id]
        )
        assert sent.status == 201, sent.body

        response = await team["member"].get(f"/api/files/{key}")
        assert response.status == 302
        location = response.headers["location"]
        assert "response-content-disposition=inline" in location
        assert "response-content-type=audio%2Fwebm" in location

    async def test_an_ordinary_audio_file_still_downloads(self, team: dict) -> None:
        """The same bytes attached as a file, not recorded as a voice message. Serving
        every audio upload inline would also widen what may become an avatar."""
        attachment_id = new_id()
        key = f"{team['workspace']}/test/{attachment_id}.mp3"
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO attachments
                      (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes)
                    VALUES (:id, :ws, :up, :key, 'song.mp3', 'audio/mpeg', 4096)
                    """
                ),
                {
                    "id": attachment_id,
                    "ws": team["workspace"],
                    "up": team["owner"].user_id,
                    "key": key,
                },
            )
        response = await team["owner"].get(f"/api/files/{key}")
        assert response.status == 302
        assert "response-content-disposition=attachment" in response.headers["location"]

    async def test_an_outsider_cannot_hear_a_private_channels_voice_note(self, team: dict) -> None:
        attachment_id, key = await _plant_voice(team["workspace"], team["owner"].user_id)
        await send_message(team["owner"], team["channel"]["id"], "", attachmentIds=[attachment_id])
        assert (await team["outsider"].get(f"/api/files/{key}")).status == 404

    async def test_a_voice_message_cannot_become_a_profile_picture(self, team: dict) -> None:
        """The avatar branch asks the *image* allowlist, which is why audio has its own."""
        attachment_id, _ = await _plant_voice(team["workspace"], team["owner"].user_id)
        response = await team["owner"].patch("/api/me", {"avatarAttachmentId": attachment_id})
        assert response.status == 400, response.body
