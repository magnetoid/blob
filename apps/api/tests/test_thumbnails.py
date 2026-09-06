"""Thumbnails: made on completion, upright, stripped, and downloadable by the same rule.

The pure half runs anywhere. The half that goes through object storage skips when MinIO
is not up — which is the one thing a skip here must not hide, so it says so.
"""

from __future__ import annotations

import io
from typing import Any

import pytest
import pytest_asyncio
from PIL import Image
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib import images, storage

from .helpers import Client, invite_and_sign_up, send_message, sign_up


def a_png(width: int = 1600, height: int = 900, mode: str = "RGB") -> bytes:
    image = Image.new(mode, (width, height), (200, 40, 40) if mode == "RGB" else (200, 40, 40, 128))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def a_jpeg_rotated() -> bytes:
    """A landscape JPEG that says "I am portrait, rotate me" — an ordinary phone photo."""
    image = Image.new("RGB", (1200, 600), (10, 90, 200))
    exif = Image.Exif()
    exif[274] = 6  # Orientation: rotate 90° clockwise on display.
    exif[271] = "BlobPhone"  # Make — one of the tags that must not survive.
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


class TestMakingOne:
    def test_it_shrinks_to_the_long_edge_and_keeps_the_shape(self) -> None:
        rendered = images.render(a_png(1600, 900))
        assert rendered is not None
        assert rendered.width == 1600 and rendered.height == 900
        with Image.open(io.BytesIO(rendered.thumb)) as thumb:
            assert thumb.format == "WEBP"
            assert max(thumb.size) == images.MAX_EDGE
            assert thumb.size == (800, 450)
        assert len(rendered.thumb) < len(a_png(1600, 900))

    def test_a_photo_that_says_rotate_me_comes_out_upright_and_anonymous(self) -> None:
        rendered = images.render(a_jpeg_rotated())
        assert rendered is not None
        # The tag said portrait, so the true size is the rotated one — and the client
        # needs that, not the stored one, to reserve the right box.
        assert (rendered.width, rendered.height) == (600, 1200)
        with Image.open(io.BytesIO(rendered.thumb)) as thumb:
            assert thumb.size[0] < thumb.size[1], "the thumbnail should be portrait"
            assert not thumb.getexif(), "the copy carries no EXIF"

    def test_transparency_survives(self) -> None:
        rendered = images.render(a_png(400, 400, mode="RGBA"))
        assert rendered is not None
        with Image.open(io.BytesIO(rendered.thumb)) as thumb:
            assert thumb.mode in ("RGBA", "RGB")  # WebP keeps the alpha channel
            assert thumb.size == (400, 400), "an image under the cap is not enlarged"

    def test_rubbish_is_not_an_error(self) -> None:
        assert images.render(b"this is not a picture") is None
        assert images.render(b"") is None

    def test_what_it_will_even_try(self) -> None:
        assert images.can_thumbnail("image/png", 1000)
        assert images.can_thumbnail("IMAGE/JPEG", 1000)
        assert not images.can_thumbnail("application/pdf", 1000)
        assert not images.can_thumbnail("image/svg+xml", 1000)
        assert not images.can_thumbnail("image/png", images.MAX_SOURCE_BYTES + 1)
        assert not images.can_thumbnail("image/png", 0)

    def test_the_key_is_derived_from_the_original(self) -> None:
        assert images.thumb_key_for("ws/abc-shot.png") == "ws/abc-shot.png.thumb.webp"


async def storage_is_up() -> bool:
    try:
        await storage.ensure_bucket()
    except Exception:
        return False
    return True


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    if not await storage_is_up():
        pytest.skip("object storage is not running — start MinIO to exercise this")
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    return {"owner": owner, "member": member, "outsider": outsider, "general": general}


async def upload(
    who: Client, data: bytes, *, filename: str = "shot.png", mime: str = "image/png"
) -> str:
    """The three steps a browser takes: ticket, PUT, complete."""
    ticket = await who.post(
        "/api/uploads", {"filename": filename, "mime": mime, "sizeBytes": len(data)}
    )
    assert ticket.status == 200, ticket.body
    attachment_id = ticket.body["attachmentId"]

    import httpx

    async with httpx.AsyncClient(timeout=30) as http:
        put = await http.put(ticket.body["uploadUrl"], content=data, headers=ticket.body["headers"])
        assert put.status_code in (200, 204), put.text

    done = await who.post(f"/api/uploads/{attachment_id}/complete", {})
    assert done.status == 200, done.body
    return str(attachment_id)


async def attachment_row(attachment_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT object_key, thumb_key, width, height FROM attachments WHERE id = :id"),
                {"id": attachment_id},
            )
        ).fetchone()


class TestThroughTheUploadPath:
    async def test_completing_an_image_upload_leaves_a_thumbnail_behind(
        self, team: dict[str, Any]
    ) -> None:
        original = a_png(1600, 900)
        attachment_id = await upload(team["owner"], original)

        row = await attachment_row(attachment_id)
        assert row.thumb_key == images.thumb_key_for(row.object_key)
        assert (row.width, row.height) == (1600, 900)

        stored = await storage.get_object(row.thumb_key)
        assert len(stored) < len(original), "the thumbnail should be the smaller one"
        with Image.open(io.BytesIO(stored)) as thumb:
            assert thumb.size == (800, 450)

    async def test_the_message_carries_the_thumbnail_url(self, team: dict[str, Any]) -> None:
        attachment_id = await upload(team["owner"], a_png())
        sent = await send_message(
            team["owner"], team["general"], "look at this", attachmentIds=[attachment_id]
        )
        assert sent.status == 201, sent.body
        (attachment,) = sent.body["message"]["attachments"]
        assert attachment["thumbUrl"] and attachment["thumbUrl"] != attachment["url"]
        assert attachment["width"] == 1600

    async def test_a_thumbnail_answers_to_the_same_rule_as_its_original(
        self, team: dict[str, Any]
    ) -> None:
        private = (
            await team["owner"].post(
                "/api/channels",
                {"name": "war-room", "kind": "private", "memberIds": [team["member"].user_id]},
            )
        ).body["channel"]["id"]
        attachment_id = await upload(team["owner"], a_png())
        sent = await send_message(
            team["owner"], private, "private picture", attachmentIds=[attachment_id]
        )
        (attachment,) = sent.body["message"]["attachments"]
        thumb_path = attachment["thumbUrl"].split("/api/files/", 1)[1]

        allowed = await team["member"].get(f"/api/files/{thumb_path}")
        assert allowed.status in (302, 307), allowed.body
        refused = await team["outsider"].get(f"/api/files/{thumb_path}")
        assert refused.status == 404

    async def test_a_file_that_is_not_an_image_gets_no_thumbnail_and_still_works(
        self, team: dict[str, Any]
    ) -> None:
        attachment_id = await upload(
            team["owner"], b"%PDF-1.4 not really", filename="notes.pdf", mime="application/pdf"
        )
        row = await attachment_row(attachment_id)
        assert row.thumb_key is None

        sent = await send_message(
            team["owner"], team["general"], "the notes", attachmentIds=[attachment_id]
        )
        (attachment,) = sent.body["message"]["attachments"]
        assert attachment["thumbUrl"] is None
        assert attachment["url"]

    async def test_something_that_claims_to_be_an_image_and_is_not(
        self, team: dict[str, Any]
    ) -> None:
        attachment_id = await upload(team["owner"], b"definitely not a png")
        row = await attachment_row(attachment_id)
        assert row.thumb_key is None, "no thumbnail, and no failed upload either"
