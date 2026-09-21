"""An agent hands over a file, and it arrives on its answer.

Janus made `index.html` on its own disk and said so in a sentence; the channel got the
sentence and nothing else, because nothing in the run carried the file. These pin the
path that now does: `CUSTOM` events named `blob.file.start`, `blob.file.chunk` and
`blob.file.end` carry the bytes in base64 pieces inside the run the agent is already
answering, and the file is attached to that answer. Nothing about it is silent — a file
that cannot be attached says so under the message, because an absence is the one failure
nobody in a channel can diagnose.
"""

from __future__ import annotations

import base64
import io
import json
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.lib import sse, storage
from blob_api.plugins import agui

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    agent_speaks,
    install,
    join_channel,
    route_agent_to,
)
from .test_thumbnails import storage_is_up


def frame(**event: Any) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


def file_frames(
    file_id: str,
    name: str,
    data: bytes,
    *,
    mime: str | None = "text/html",
    piece: int = 4,
    size: int | None = None,
    end: bool = True,
) -> list[bytes]:
    """A file as the three events carry it, cut into `piece`-byte chunks."""
    start: dict[str, Any] = {"id": file_id, "name": name}
    if mime is not None:
        start["mimeType"] = mime
    if size is not None:
        start["size"] = size
    frames = [frame(type="CUSTOM", name="blob.file.start", value=start)]
    for offset in range(0, len(data), piece):
        encoded = base64.b64encode(data[offset : offset + piece]).decode()
        frames.append(
            frame(type="CUSTOM", name="blob.file.chunk", value={"id": file_id, "data": encoded})
        )
    if end:
        frames.append(frame(type="CUSTOM", name="blob.file.end", value={"id": file_id}))
    return frames


def text(message_id: str, body: str) -> list[bytes]:
    return [
        frame(type="TEXT_MESSAGE_START", messageId=message_id),
        frame(type="TEXT_MESSAGE_CONTENT", messageId=message_id, delta=body),
        frame(type="TEXT_MESSAGE_END", messageId=message_id),
    ]


STARTED = frame(type="RUN_STARTED", threadId="t", runId="r")
FINISHED = frame(type="RUN_FINISHED", threadId="t", runId="r")

PAGE = b"<!doctype html><html><body><h1>Hadley</h1></body></html>"


def fold(*chunks: bytes, **options: Any) -> tuple[agui.Fold, list[agui.Post]]:
    """Feed raw bytes through the decoder and the reducer, as the job does."""
    decoder, reducer = sse.SseDecoder(), agui.Fold(**options)
    posts: list[agui.Post] = []
    for chunk in chunks:
        for event in decoder.feed(chunk):
            posts.extend(reducer.feed(event))
    for event in decoder.close():
        posts.extend(reducer.feed(event))
    posts.extend(reducer.finish())
    return reducer, posts


class TestTheFold:
    def test_a_file_rides_on_the_answer_that_follows_it(self) -> None:
        _, posts = fold(
            STARTED, *file_frames("f1", "index.html", PAGE), *text("m1", "Built it."), FINISHED
        )

        assert len(posts) == 1
        assert posts[0].body == "Built it."
        assert [(f.name, f.mime, f.data) for f in posts[0].files] == [
            ("index.html", "text/html", PAGE)
        ]

    def test_a_file_arriving_after_the_answer_joins_it(self) -> None:
        # Nothing is written until the stream ends, so the answer is still in hand: a
        # second message holding only the file would split one reply in two.
        _, posts = fold(
            STARTED, *text("m1", "Built it."), *file_frames("f1", "index.html", PAGE), FINISHED
        )

        assert len(posts) == 1
        assert posts[0].body == "Built it."
        assert [f.name for f in posts[0].files] == ["index.html"]

    def test_a_run_that_only_sends_a_file_still_posts_it(self) -> None:
        _, posts = fold(STARTED, *file_frames("f1", "report.pdf", b"%PDF-1.7 ..."), FINISHED)

        assert len(posts) == 1
        assert posts[0].body == ""
        assert [f.name for f in posts[0].files] == ["report.pdf"]

    def test_pieces_are_reassembled_in_order(self) -> None:
        data = bytes(range(256)) * 3
        _, posts = fold(
            STARTED, *file_frames("f1", "blob.bin", data, piece=7), *text("m1", "Here."), FINISHED
        )

        assert posts[0].files[0].data == data

    def test_a_missing_type_is_left_for_the_job_to_guess(self) -> None:
        _, posts = fold(
            STARTED, *file_frames("f1", "notes.md", b"# hi", mime=None), *text("m1", "x"), FINISHED
        )

        assert posts[0].files[0].mime is None

    def test_a_file_that_never_finishes_is_dropped_and_said_so(self) -> None:
        _, posts = fold(
            STARTED,
            *file_frames("f1", "index.html", PAGE, end=False),
            *text("m1", "Built it."),
            FINISHED,
        )

        assert posts[0].files == []
        assert any("index.html" in note for note in posts[0].notes)

    def test_a_file_shorter_than_it_declared_is_dropped(self) -> None:
        _, posts = fold(
            STARTED,
            *file_frames("f1", "index.html", PAGE, size=len(PAGE) + 10),
            *text("m1", "Built it."),
            FINISHED,
        )

        assert posts[0].files == []
        assert any("index.html" in note for note in posts[0].notes)

    def test_a_piece_that_is_not_base64_drops_that_file_and_nothing_else(self) -> None:
        broken = frame(type="CUSTOM", name="blob.file.chunk", value={"id": "f1", "data": "@@@"})
        _, posts = fold(
            STARTED,
            frame(type="CUSTOM", name="blob.file.start", value={"id": "f1", "name": "a.txt"}),
            broken,
            frame(type="CUSTOM", name="blob.file.end", value={"id": "f1"}),
            *file_frames("f2", "b.txt", b"fine", mime="text/plain"),
            *text("m1", "Two files."),
            FINISHED,
        )

        assert [f.name for f in posts[0].files] == ["b.txt"]
        assert any("a.txt" in note for note in posts[0].notes)

    def test_files_over_the_run_budget_are_dropped(self) -> None:
        _, posts = fold(
            STARTED,
            *file_frames("f1", "small.txt", b"12345", mime="text/plain"),
            *file_frames("f2", "large.txt", b"1234567890", mime="text/plain"),
            *text("m1", "Two files."),
            FINISHED,
            max_file_bytes=12,
        )

        assert [f.name for f in posts[0].files] == ["small.txt"]
        assert any("large.txt" in note for note in posts[0].notes)

    def test_no_more_than_the_cap_of_files_is_kept(self) -> None:
        frames: list[bytes] = []
        for n in range(agui.FILE_MAX_ITEMS + 2):
            frames.extend(file_frames(f"f{n}", f"{n}.txt", b"x", mime="text/plain"))
        _, posts = fold(STARTED, *frames, *text("m1", "Many."), FINISHED)

        assert len(posts[0].files) == agui.FILE_MAX_ITEMS

    def test_a_piece_for_a_file_never_started_is_ignored(self) -> None:
        stray = frame(type="CUSTOM", name="blob.file.chunk", value={"id": "nope", "data": "eA=="})
        _, posts = fold(STARTED, stray, *text("m1", "Nothing attached."), FINISHED)

        assert posts[0].files == []
        assert posts[0].notes == []

    def test_a_note_reaches_the_channel_as_a_context_line(self) -> None:
        _, posts = fold(
            STARTED,
            *file_frames("f1", "index.html", PAGE, end=False),
            *text("m1", "Built it."),
            FINISHED,
        )

        blocks = posts[0].blocks()
        assert blocks is not None
        lines = [e["text"] for b in blocks for e in b["elements"]]
        assert any("index.html" in line for line in lines)

    def test_a_note_with_nothing_to_ride_on_gets_a_message_of_its_own(self) -> None:
        _, posts = fold(STARTED, *file_frames("f1", "index.html", PAGE, end=False), FINISHED)

        assert len(posts) == 1
        assert posts[0].files == []
        assert any("index.html" in note for note in posts[0].notes)


class TestTheStream:
    """The byte ceiling on a run was written for text. A file is bigger than any answer."""

    @staticmethod
    def listener() -> Any:
        from blob_api.plugins.streams import Listener

        return Listener(
            plugin_id="p",
            slug="helper",
            name="Helper",
            bot_user_id="u",
            agui_url="https://apps.example.com/agui",
            signing_secret="s",
        )

    @staticmethod
    def transport(*chunks: bytes) -> Any:
        import httpx

        def handler(_request: httpx.Request) -> httpx.Response:
            async def body() -> Any:
                for chunk in chunks:
                    yield chunk

            headers = {"content-type": "text/event-stream"}
            return httpx.Response(200, headers=headers, content=body())

        return httpx.MockTransport(handler)

    async def test_a_file_larger_than_the_text_budget_still_arrives(self) -> None:
        from blob_api.config import settings
        from blob_api.plugins import streams

        data = b"x" * (settings.AGUI_MAX_BYTES + 1024)
        chunks = [STARTED, *file_frames("f1", "big.bin", data, piece=192 * 1024, mime=None)]
        chunks += [*text("m1", "Here it is."), FINISHED]

        _, posts, error = await streams.stream_run(
            self.listener(), {}, transport=self.transport(*chunks)
        )

        assert error is None
        assert posts[0].files[0].data == data

    async def test_the_ceiling_still_holds_past_the_file_budget(self) -> None:
        from blob_api.plugins import streams

        flood = frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="y" * 65_536)
        chunks = [STARTED, frame(type="TEXT_MESSAGE_START", messageId="m1")]
        chunks += [flood] * (streams.read_budget() // 65_536 + 2)

        _, _posts, error = await streams.stream_run(
            self.listener(), {}, transport=self.transport(*chunks)
        )

        assert error == "the agent sent more than we will read"

    def test_the_budget_is_the_text_ceiling_plus_the_files_in_base64(self) -> None:
        from blob_api.config import settings
        from blob_api.plugins import streams

        files_as_base64 = 4 * -(-settings.AGUI_MAX_FILE_BYTES // 3)
        assert streams.read_budget() == settings.AGUI_MAX_BYTES + files_as_base64


# --- The job: a folded file becomes an attachment on the agent's answer. -----------------


@pytest_asyncio.fixture
async def team(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    if not await storage_is_up():
        pytest.skip("object storage is not running — start MinIO to exercise this")
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    app_body = await install(owner)
    await join_channel(owner, app_body, general)
    return {
        "owner": owner,
        "member": member,
        "general": general,
        "monkeypatch": monkeypatch,
        "workspace_id": await workspace_id_of(owner),
    }


async def run_with(team: dict[str, Any], *chunks: bytes) -> dict[str, Any]:
    """Mention the agent, let it say `chunks`, and return its answer as a person sees it."""
    transport, _ = agent_speaks(*chunks)
    route_agent_to(team["monkeypatch"], transport)
    sent = await send_message(team["owner"], team["general"], "@Helper build the page")
    await agui_job.handle_agui_run(sent.body["message"]["id"])
    return await answer_in(team)


async def answer_in(team: dict[str, Any]) -> dict[str, Any]:
    history = await team["member"].get(f"/api/channels/{team['general']}/messages")
    assert history.status == 200, history.body
    answers = [m for m in history.body["messages"] if m["kind"] == "bot"]
    assert len(answers) == 1, answers
    return dict(answers[0])


async def stored_bytes(attachment_id: str) -> bytes:
    async with SessionFactory() as session:
        key = (
            await session.execute(
                sql("SELECT object_key FROM attachments WHERE id = :id"), {"id": attachment_id}
            )
        ).scalar_one()
    return await storage.get_object(key)


def context_lines(message: dict[str, Any]) -> list[str]:
    return [
        element["text"]
        for block in message.get("blocks") or []
        if block["type"] == "context"
        for element in block["elements"]
    ]


def png(width: int = 40, height: int = 30) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 80, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


class TestTheTypeOfAFile:
    """What a file is stored as must not depend on which Python the server runs.

    CPython's own table learned `.md` partway through 3.12 — 3.12.3 on the CI runner
    guesses nothing for it, 3.12.12 on a laptop says `text/markdown` — so the types the
    preview panel depends on are Blob's to state, not the interpreter's.
    """

    def test_a_document_is_markdown_whatever_python_knows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.services import agent_files

        monkeypatch.setattr(agent_files._TYPES, "guess_type", lambda *_a, **_k: (None, None))

        assert agent_files.type_of("notes.md", None) == "text/markdown"
        assert agent_files.type_of("README.markdown", None) == "text/markdown"
        assert agent_files.type_of("compose.yaml", None) == "application/yaml"

    def test_a_claim_wins_and_an_empty_one_is_no_claim(self) -> None:
        from blob_api.services import agent_files

        assert agent_files.type_of("notes.md", "text/plain; charset=utf-8") == "text/plain"
        assert agent_files.type_of("notes.md", "application/octet-stream") == "text/markdown"
        assert agent_files.type_of("mystery", None) == "application/octet-stream"


class TestTheJob:
    async def test_the_file_is_attached_to_the_agents_answer(self, team: dict[str, Any]) -> None:
        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "index.html", PAGE),
            *text("m1", "Built it."),
            FINISHED,
        )

        assert answer["body"] == "Built it."
        (attachment,) = answer["attachments"]
        assert attachment["filename"] == "index.html"
        assert attachment["mime"] == "text/html"
        assert attachment["sizeBytes"] == len(PAGE)
        assert await stored_bytes(attachment["id"]) == PAGE
        assert context_lines(answer) == []

    async def test_a_missing_type_is_guessed_from_the_name(self, team: dict[str, Any]) -> None:
        answer = await run_with(
            team, STARTED, *file_frames("f1", "notes.md", b"# Plan\n", mime=None), FINISHED
        )

        (attachment,) = answer["attachments"]
        assert attachment["mime"] == "text/markdown"

    async def test_an_image_gets_its_thumbnail_and_size(self, team: dict[str, Any]) -> None:
        picture = png(40, 30)
        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "chart.png", picture, mime="image/png", piece=512),
            *text("m1", "The chart."),
            FINISHED,
        )

        (attachment,) = answer["attachments"]
        assert (attachment["width"], attachment["height"]) == (40, 30)
        assert attachment["thumbUrl"]

    async def test_a_program_is_refused_with_a_line_under_the_answer(
        self, team: dict[str, Any]
    ) -> None:
        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "setup.exe", b"MZ\x90\x00", mime="application/octet-stream"),
            *text("m1", "Installer attached."),
            FINISHED,
        )

        assert answer["attachments"] == []
        assert any("setup.exe" in line for line in context_lines(answer))

    async def test_a_page_in_disguise_is_refused(self, team: dict[str, Any]) -> None:
        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "chart.png", PAGE, mime="image/png"),
            *text("m1", "The chart."),
            FINISHED,
        )

        assert answer["attachments"] == []
        assert any("chart.png" in line for line in context_lines(answer))

    async def test_a_file_over_the_workspace_limit_is_refused(self, team: dict[str, Any]) -> None:
        async with SessionFactory() as session:
            await session.execute(
                sql(
                    """
                    INSERT INTO workspace_settings (workspace_id, settings)
                    VALUES (:ws, cast(:s AS jsonb))
                    ON CONFLICT (workspace_id) DO UPDATE SET settings = EXCLUDED.settings
                    """
                ),
                {"ws": team["workspace_id"], "s": json.dumps({"uploadLimitBytes": 1024})},
            )
            await session.commit()

        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "big.txt", b"x" * 2048, mime="text/plain", piece=512),
            *text("m1", "Here."),
            FINISHED,
        )

        assert answer["attachments"] == []
        assert any("big.txt" in line for line in context_lines(answer))

    async def test_storage_failing_still_posts_the_answer_and_says_so(
        self, team: dict[str, Any]
    ) -> None:
        async def broken(*_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("storage is down")

        team["monkeypatch"].setattr(storage, "put_object", broken)

        answer = await run_with(
            team,
            STARTED,
            *file_frames("f1", "index.html", PAGE),
            *text("m1", "Built it."),
            FINISHED,
        )

        assert answer["body"] == "Built it."
        assert answer["attachments"] == []
        assert any("index.html" in line for line in context_lines(answer))

    async def test_running_the_job_twice_attaches_the_file_once(self, team: dict[str, Any]) -> None:
        transport, _ = agent_speaks(
            STARTED, *file_frames("f1", "index.html", PAGE), *text("m1", "Built it."), FINISHED
        )
        route_agent_to(team["monkeypatch"], transport)
        sent = await send_message(team["owner"], team["general"], "@Helper build the page")
        await agui_job.handle_agui_run(sent.body["message"]["id"])
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        answer = await answer_in(team)
        assert len(answer["attachments"]) == 1
