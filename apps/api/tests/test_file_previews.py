"""A file opens in the side panel: its text, or its PDF, and nothing that could run.

`GET /api/attachments/{id}/preview` is the one place file bytes pass through this process
on their way to a browser, and it is narrow on purpose. Text comes back as `text/plain`
under a policy that forbids everything — the client decides whether that text is
markdown, a table or a page, and a page only ever runs inside the no-network sandbox the
work channel's preview uses. A PDF streams inline for the browser's own viewer, framable
by this origin and no other. Everything else has no preview and says so, and the rule for
who may look is the download rule, unchanged: a member of the channel, or the uploader of
a file not yet sent.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio

from blob_api.routers import files as files_router

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_thumbnails import storage_is_up, upload

PAGE = b"<!doctype html><html><body><script>alert(1)</script><h1>Hi</h1></body></html>"
PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    if not await storage_is_up():
        pytest.skip("object storage is not running — start MinIO to exercise this")
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    return {"owner": owner, "member": member, "outsider": outsider, "general": general}


async def shared(team: dict[str, Any], data: bytes, filename: str, mime: str) -> str:
    """A file the owner posted in #general; returns its attachment id."""
    attachment_id = await upload(team["owner"], data, filename=filename, mime=mime)
    sent = await send_message(
        team["owner"], team["general"], "a file", attachmentIds=[attachment_id]
    )
    assert sent.status == 201, sent.body
    return attachment_id


def preview_of(attachment_id: str) -> str:
    return f"/api/attachments/{attachment_id}/preview"


class TestPagesMayBeShared:
    async def test_a_person_may_share_an_html_page(self, team: dict[str, Any]) -> None:
        attachment_id = await upload(team["owner"], PAGE, filename="index.html", mime="text/html")
        assert attachment_id

    async def test_a_program_is_still_refused_by_name(self, team: dict[str, Any]) -> None:
        ticket = await team["owner"].post(
            "/api/uploads",
            {"filename": "setup.exe", "mime": "application/octet-stream", "sizeBytes": 4},
        )
        assert ticket.status == 400


class TestWhoMayLook:
    async def test_a_member_of_the_channel_may(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, b"# Plan\n", "plan.md", "text/markdown")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 200
        assert answer.body == "# Plan\n"

    async def test_somebody_outside_a_private_channel_gets_404(self, team: dict[str, Any]) -> None:
        private = (
            await team["owner"].post(
                "/api/channels",
                {"name": "war-room", "kind": "private", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        attachment_id = await upload(team["owner"], b"secret", filename="s.txt", mime="text/plain")
        await send_message(team["owner"], private, "shh", attachmentIds=[attachment_id])

        assert (await team["member"].get(preview_of(attachment_id))).status == 200
        refused = await team["outsider"].get(preview_of(attachment_id))
        assert refused.status == 404

    async def test_a_file_not_yet_sent_is_only_its_uploaders(self, team: dict[str, Any]) -> None:
        attachment_id = await upload(team["owner"], b"draft", filename="d.txt", mime="text/plain")

        assert (await team["owner"].get(preview_of(attachment_id))).status == 200
        assert (await team["member"].get(preview_of(attachment_id))).status == 404

    async def test_an_id_that_is_not_one_is_404(self, team: dict[str, Any]) -> None:
        assert (await team["owner"].get(preview_of("not-an-id"))).status in (400, 404)


class TestWhatComesBack:
    async def test_a_page_comes_back_as_inert_text(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, PAGE, "index.html", "text/html")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 200
        assert answer.body == PAGE.decode()
        assert answer.headers["content-type"].startswith("text/plain")
        assert answer.headers["x-content-type-options"] == "nosniff"
        policy = answer.headers["content-security-policy"]
        assert "sandbox" in policy and "default-src 'none'" in policy

    async def test_a_table_is_text_too(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, b"name,count\nana,1\n", "counts.csv", "text/csv")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 200
        assert answer.body == "name,count\nana,1\n"

    async def test_a_pdf_streams_inline_for_this_origin_to_frame(
        self, team: dict[str, Any]
    ) -> None:
        attachment_id = await shared(team, PDF, "report.pdf", "application/pdf")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 200
        assert answer.headers["content-type"] == "application/pdf"
        assert answer.headers["content-disposition"].startswith("inline")
        assert answer.headers["x-frame-options"] == "SAMEORIGIN"
        assert "frame-ancestors 'self'" in answer.headers["content-security-policy"]
        assert answer.body.startswith("%PDF")

    async def test_a_pdf_that_is_not_one_has_no_preview(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, b"just some text", "fake.pdf", "application/pdf")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "no_preview"

    async def test_an_archive_has_no_preview(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, b"PK\x03\x04rest", "site.zip", "application/zip")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "no_preview"

    async def test_text_that_is_not_utf8_has_no_preview(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, b"\xff\xfe\x00\xd8bad", "odd.txt", "text/plain")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "no_preview"

    async def test_text_too_large_to_show_says_so(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(files_router, "TEXT_PREVIEW_MAX_BYTES", 8)
        attachment_id = await shared(team, b"0123456789", "long.txt", "text/plain")

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "preview_too_large"


def page_of(attachment_id: str) -> str:
    return f"/api/attachments/{attachment_id}/page"


class TestAPageRunsInItsOwnSandbox:
    """A page is served as itself, under a policy of its own, and never as this origin.

    It cannot be framed from `srcdoc`: a `srcdoc` document inherits the policy of the page
    that frames it, and the app's `script-src 'self'` blocks every inline script a page
    has — measured in Chrome, where the work channel's preview had been running pages
    with their scripts silently refused. Served from its own URL the header is the only
    policy, and it says: a sandbox with scripts and nothing else, no network, framed by
    this origin alone. The `sandbox` directive holds even if somebody opens the URL
    directly, so the page never runs as this origin.
    """

    async def test_a_page_comes_back_as_html_in_a_sandbox(self, team: dict[str, Any]) -> None:
        attachment_id = await shared(team, PAGE, "index.html", "text/html")

        answer = await team["member"].get(page_of(attachment_id))

        assert answer.status == 200
        assert answer.headers["content-type"].startswith("text/html")
        assert answer.body == PAGE.decode()
        policy = answer.headers["content-security-policy"]
        assert "sandbox allow-scripts" in policy
        assert "allow-same-origin" not in policy
        assert "default-src 'none'" in policy
        assert "connect-src 'none'" in policy
        assert "frame-ancestors 'self'" in policy
        assert answer.headers["x-frame-options"] == "SAMEORIGIN"
        assert answer.headers["x-content-type-options"] == "nosniff"

    async def test_it_answers_to_the_download_rule(self, team: dict[str, Any]) -> None:
        private = (
            await team["owner"].post(
                "/api/channels",
                {"name": "war-room", "kind": "private", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        attachment_id = await upload(team["owner"], PAGE, filename="p.html", mime="text/html")
        await send_message(team["owner"], private, "page", attachmentIds=[attachment_id])

        assert (await team["member"].get(page_of(attachment_id))).status == 200
        assert (await team["outsider"].get(page_of(attachment_id))).status == 404

    async def test_only_a_page_is_served_as_one(self, team: dict[str, Any]) -> None:
        for data, name, mime in (
            (b"# Plan\n", "plan.md", "text/markdown"),
            (b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "logo.svg", "image/svg+xml"),
            (PDF, "report.pdf", "application/pdf"),
        ):
            attachment_id = await shared(team, data, name, mime)
            answer = await team["member"].get(page_of(attachment_id))
            assert answer.status == 400, name
            assert answer.body["error"]["code"] == "no_preview", name

    async def test_a_page_too_long_says_so(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(files_router, "TEXT_PREVIEW_MAX_BYTES", 8)
        attachment_id = await shared(team, PAGE, "index.html", "text/html")

        answer = await team["member"].get(page_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "preview_too_large"


class TestTheSizeThatCounts:
    async def test_a_file_bigger_than_it_declared_is_measured_not_trusted(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The ticket's size is the uploader's word and the presigned PUT does not pin it,
        # so a preview must read no more than its cap whatever the row says.
        import httpx

        monkeypatch.setattr(files_router, "TEXT_PREVIEW_MAX_BYTES", 8)
        real = b"0123456789" * 3
        ticket = await team["owner"].post(
            "/api/uploads", {"filename": "small.txt", "mime": "text/plain", "sizeBytes": 4}
        )
        assert ticket.status == 200, ticket.body
        async with httpx.AsyncClient(timeout=30) as http:
            put = await http.put(
                ticket.body["uploadUrl"], content=real, headers=ticket.body["headers"]
            )
            assert put.status_code in (200, 204), put.text
        attachment_id = ticket.body["attachmentId"]
        done = await team["owner"].post(f"/api/uploads/{attachment_id}/complete", {})
        assert done.status == 200, done.body
        await send_message(team["owner"], team["general"], "f", attachmentIds=[attachment_id])

        answer = await team["member"].get(preview_of(attachment_id))

        assert answer.status == 400
        assert answer.body["error"]["code"] == "preview_too_large"
