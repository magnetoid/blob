"""Thumbnails: made on completion, upright, stripped, and downloadable by the same rule —
and the original losing where it was taken, and nothing else.

The pure half runs anywhere. The half that goes through object storage skips when MinIO
is not up — which is the one thing a skip here must not hide, so it says so.
"""

from __future__ import annotations

import asyncio
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


LATITUDE = (44.0, 49.0, 12.5)
LONGITUDE = (20.0, 27.0, 33.25)


def big_endian_exif() -> bytes:
    """A Motorola-order EXIF block written by hand, the way some cameras write it:
    IFD0 with Orientation, Make and the GPS pointer; a GPS directory with a reference
    letter stored inline and a latitude stored out of line."""
    import struct

    make = b"BlobPhone\x00"
    ifd0_at, ifd0_entries = 8, 3
    make_at = ifd0_at + 2 + ifd0_entries * 12 + 4
    gps_at = make_at + len(make)
    gps_entries = 2
    lat_at = gps_at + 2 + gps_entries * 12 + 4
    tiff = b"MM\x00\x2a" + struct.pack(">I", ifd0_at)
    tiff += struct.pack(">H", ifd0_entries)
    tiff += struct.pack(">HHI", 271, 2, len(make)) + struct.pack(">I", make_at)
    tiff += struct.pack(">HHIHH", 274, 3, 1, 6, 0)
    tiff += struct.pack(">HHII", 0x8825, 4, 1, gps_at)
    tiff += struct.pack(">I", 0) + make
    tiff += struct.pack(">H", gps_entries)
    tiff += struct.pack(">HHI", 1, 2, 2) + b"N\x00\x00\x00"
    tiff += struct.pack(">HHII", 2, 5, 3, lat_at)
    tiff += struct.pack(">I", 0)
    tiff += struct.pack(">IIIIII", 44, 1, 49, 1, 125, 10)
    return b"Exif\x00\x00" + tiff


def a_jpeg_with_location(*, byte_order: str = "II", xmp: bool = False) -> bytes:
    """A phone photo: rotate-me, a maker, and where it was taken."""
    image = Image.new("RGB", (240, 160), (10, 90, 200))
    exif = Image.Exif()
    exif[274] = 6
    exif[271] = "BlobPhone"
    position = {1: "N", 2: LATITUDE, 3: "E", 4: LONGITUDE, 6: 117.0}
    exif[0x8825] = position
    raw = exif.tobytes()
    if byte_order == "MM":
        raw = big_endian_exif()
    buffer = io.BytesIO()
    extra: dict[str, Any] = {}
    if xmp:
        extra["xmp"] = (
            b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description '
            b'exif:GPSLatitude="44,49.2083N" exif:GPSLongitude="20,27.5542E">'
            b"<exif:GPSAltitude>117/1</exif:GPSAltitude></rdf:Description></rdf:RDF>"
            b"</x:xmpmeta>"
        )
    image.save(buffer, format="JPEG", exif=raw, quality=90, **extra)
    return buffer.getvalue()


class TestWhereItWasTaken:
    @pytest.mark.parametrize("byte_order", ["II", "MM"])
    def test_the_position_goes_and_nothing_else_does(self, byte_order: str) -> None:
        original = a_jpeg_with_location(byte_order=byte_order)
        with Image.open(io.BytesIO(original)) as before:
            assert dict(before.getexif().get_ifd(0x8825)), "the fixture should carry GPS"

        cleaned = images.without_location(original)
        assert cleaned is not None
        assert len(cleaned) == len(original), "same length, so the signed size still holds"
        with Image.open(io.BytesIO(cleaned)) as after, Image.open(io.BytesIO(original)) as before:
            exif = after.getexif()
            assert not dict(exif.get_ifd(0x8825)), "no GPS fields remain"
            assert exif.get(274) == 6, "orientation survives, so it opens the right way up"
            assert exif.get(271) == "BlobPhone"
            assert after.tobytes() == before.tobytes(), "not one pixel re-encoded"

    def test_the_xmp_copy_goes_too(self) -> None:
        original = a_jpeg_with_location(xmp=True)
        assert b"44,49.2083N" in original
        cleaned = images.without_location(original)
        assert cleaned is not None and len(cleaned) == len(original)
        assert b"44,49.2083N" not in cleaned
        assert b"20,27.5542E" not in cleaned
        assert b"<exif:GPSAltitude>117/1<" not in cleaned
        with Image.open(io.BytesIO(cleaned)) as after:
            after.load()

    def test_nothing_to_take_is_none(self) -> None:
        assert images.without_location(a_jpeg_rotated()) is None
        assert images.without_location(a_png()) is None
        assert images.without_location(b"") is None

    def test_a_file_it_cannot_be_sure_of_is_left_alone(self) -> None:
        original = a_jpeg_with_location()
        # Truncated in the middle of the EXIF segment: the offsets cannot be trusted, so
        # nothing is written rather than zeros in the wrong place.
        assert images.without_location(original[:60]) is None
        assert images.without_location(b"\xff\xd8\xff\xe1\x00\x02") is None


class TestReplacingAHead:
    async def test_a_head_shorter_than_a_part_or_as_long_as_the_object_is_refused(
        self,
    ) -> None:
        with pytest.raises(ValueError):
            await storage.replace_head("k", b"x" * 10, total=100, mime="image/jpeg")
        part = b"x" * storage.MIN_PART_BYTES
        with pytest.raises(ValueError):
            await storage.replace_head("k", part, total=len(part), mime="image/jpeg")


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
    """Ask the bucket directly, not through `ensure_bucket`.

    `ensure_bucket` swallows its failures on purpose — a managed bucket usually denies
    CreateBucket and the upload is what reports a real problem. So it never raises, this
    used to always answer True, and the tests below failed with a bare `ConnectError`
    instead of skipping. Which is exactly what this module's docstring says a skip here
    must not hide, so it was hiding the opposite: not that storage was fine, but that
    nobody could tell.
    """
    bucket = storage.settings.S3_BUCKET
    try:
        await asyncio.to_thread(storage._client().head_bucket, Bucket=bucket)
    except Exception:
        try:
            await asyncio.to_thread(storage._client().create_bucket, Bucket=bucket)
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

        stored = await storage.get_object(row.thumb_key, max_bytes=8 * 1024 * 1024)
        assert len(stored) < len(original), "the thumbnail should be the smaller one"
        with Image.open(io.BytesIO(stored)) as thumb:
            assert thumb.size == (800, 450)

    async def test_a_photo_loses_where_it_was_taken_before_anybody_can_download_it(
        self, team: dict[str, Any]
    ) -> None:
        original = a_jpeg_with_location()
        attachment_id = await upload(
            team["owner"], original, filename="whiteboard.jpg", mime="image/jpeg"
        )
        row = await attachment_row(attachment_id)
        stored = await storage.get_object(row.object_key, max_bytes=8 * 1024 * 1024)
        assert len(stored) == len(original)
        with Image.open(io.BytesIO(stored)) as kept:
            assert not dict(kept.getexif().get_ifd(0x8825))
            assert kept.getexif().get(274) == 6

    async def test_a_photo_too_big_to_thumbnail_still_loses_where_it_was_taken(
        self, team: dict[str, Any]
    ) -> None:
        """Past the thumbnail's 30 MB the image is never decoded, but its location is
        still in its first few kilobytes — so the head is rewritten and storage copies
        the rest. The review of the first version found large photos kept their GPS."""
        photo = a_jpeg_with_location()
        # Bytes after the end-of-image marker are ignored by every reader, which makes
        # this a valid JPEG of any size without encoding 30 MB of pixels.
        padding = bytes(range(256)) * ((images.MAX_SOURCE_BYTES + 1024 * 1024) // 256)
        original = photo + padding
        attachment_id = await upload(
            team["owner"], original, filename="panorama.jpg", mime="image/jpeg"
        )
        row = await attachment_row(attachment_id)
        assert row.thumb_key is None, "too big to thumbnail, as before"

        stored = await storage.get_object(row.object_key, max_bytes=len(original) + 1)
        assert len(stored) == len(original)
        assert stored[len(photo) :] == padding, "everything past the head is untouched"
        with Image.open(io.BytesIO(stored)) as kept:
            assert not dict(kept.getexif().get_ifd(0x8825))
            assert kept.getexif().get(274) == 6

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
        """Used to complete anyway and just skip the thumbnail. Now the lie is refused."""
        import httpx

        who = team["owner"]
        data = b"definitely not a png"
        ticket = await who.post(
            "/api/uploads", {"filename": "shot.png", "mime": "image/png", "sizeBytes": len(data)}
        )
        assert ticket.status == 200, ticket.body
        async with httpx.AsyncClient(timeout=30) as http:
            put = await http.put(
                ticket.body["uploadUrl"], content=data, headers=ticket.body["headers"]
            )
            assert put.status_code in (200, 204), put.text
        done = await who.post(f"/api/uploads/{ticket.body['attachmentId']}/complete", {})
        assert done.status == 400, done.body
        assert "image" in done.body["error"]["message"]
