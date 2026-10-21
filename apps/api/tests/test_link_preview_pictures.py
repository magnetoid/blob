"""Link previews draw the page's picture — Blob's own copy (M3 · B3).

The unfurl job fetches the picture a page names, once, by the guarded path the page itself
was fetched by, and keeps a small WebP beside the message. A reader's browser asks Blob for
it, never the page's server, so no third party learns who read the message. These pin the
copy, its privacy, and the pictures that are refused.
"""

from __future__ import annotations

import io
import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from PIL import Image
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import unfurl as unfurl_job
from blob_api.lib import net, storage

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of


def png(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (40, 120, 80)).save(buffer, format="PNG")
    return buffer.getvalue()


PAGE = (
    b"<html><head>"
    b'<meta property="og:title" content="Launch notes">'
    b'<meta property="og:site_name" content="Northwind Blog">'
    b'<meta property="og:image" content="/img/cover.png">'
    b"</head><body>hello</body></html>"
)


@pytest_asyncio.fixture
async def site(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A public website (pages by path), storage that records what Blob keeps, and two
    people in #general."""
    owner = await sign_up(client, "Pia Owner")
    other = await invite_and_sign_up(owner, "Oskar Other")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    await owner.post(f"/api/channels/{general}/members", {"userIds": [other.user_id]})

    state: dict[str, Any] = {
        "owner": owner,
        "other": other,
        "general": general,
        "pages": {
            "/story": ("text/html", PAGE),
            "/img/cover.png": ("image/png", png(640, 320)),
        },
        "requested": [],
        "kept": {},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        state["requested"].append(f"{request.headers['host']}{request.url.path}")
        page = state["pages"].get(request.url.path)
        if page is None:
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": page[0]}, content=page[1])

    real_client = httpx.AsyncClient

    def fake_client(**kwargs: object) -> httpx.AsyncClient:
        kwargs.pop("transport", None)
        return real_client(**kwargs, transport=httpx.MockTransport(handler))  # type: ignore[arg-type]

    async def public(hostname: str, port: int | None) -> list[str]:
        # An address literal resolves to itself; every name to a public address.
        return [hostname] if hostname[0].isdigit() else ["93.184.215.14"]

    async def keep(key: str, body: bytes, mime: str) -> None:
        state["kept"][key] = (body, mime)

    monkeypatch.setattr(unfurl_job.httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(net, "resolve", public)
    monkeypatch.setattr(storage, "put_object", keep)
    return state


async def post_link(site: dict[str, Any], channel_id: str | None = None) -> str:
    sent = await send_message(
        site["owner"], channel_id or site["general"], "see https://news.example.com/story"
    )
    assert sent.status == 201, sent.body
    message_id = str(sent.body["message"]["id"])
    await unfurl_job.handle_unfurl(message_id)
    return message_id


async def preview_of(reader: Client, channel_id: str, message_id: str) -> Any:
    listed = await reader.get(f"/api/channels/{channel_id}/messages")
    assert listed.status == 200, listed.body
    (message,) = [m for m in listed.body["messages"] if m["id"] == message_id]
    return message["linkPreview"]


async def stored_preview(message_id: str) -> dict[str, Any]:
    async with SessionFactory() as session:
        raw = (
            await session.execute(
                text("SELECT link_preview FROM messages WHERE id = :id"), {"id": message_id}
            )
        ).scalar_one()
    return dict(raw)


class TestThePicture:
    async def test_is_kept_as_blobs_own_copy_and_drawn_from_there(
        self, site: dict[str, Any]
    ) -> None:
        message_id = await post_link(site)
        workspace = await workspace_id_of(site["owner"])
        key = f"{workspace}/link-previews/{message_id}.webp"

        assert await preview_of(site["other"], site["general"], message_id) == {
            "url": "https://news.example.com/story",
            "title": "Launch notes",
            "description": None,
            "imageUrl": f"/api/messages/{message_id}/preview-image",
            "imageWidth": 640,
            "imageHeight": 320,
            "siteName": "Northwind Blog",
        }
        body, mime = site["kept"][key]
        assert mime == "image/webp"
        assert Image.open(io.BytesIO(body)).format == "WEBP"
        # The relative address was read against the page, and fetched from there.
        assert "news.example.com/img/cover.png" in site["requested"]
        # The page's own address for it is stored nowhere.
        assert "imageUrl" not in await stored_preview(message_id)

    async def test_a_reader_is_sent_to_the_copy(self, site: dict[str, Any]) -> None:
        message_id = await post_link(site)
        answer = await site["other"].get(f"/api/messages/{message_id}/preview-image")
        assert answer.status == 302
        assert f"link-previews/{message_id}.webp" in answer.headers["location"]

    async def test_is_as_private_as_its_channel(self, site: dict[str, Any]) -> None:
        made = await site["owner"].post("/api/channels", {"name": "board", "kind": "private"})
        assert made.status in (200, 201), made.body
        message_id = await post_link(site, made.body["channel"]["id"])
        outsider = await site["other"].get(f"/api/messages/{message_id}/preview-image")
        assert outsider.status == 404

    async def test_goes_with_a_deleted_message(self, site: dict[str, Any]) -> None:
        message_id = await post_link(site)
        deleted = await site["owner"].delete(f"/api/messages/{message_id}")
        assert deleted.status == 200, deleted.body
        answer = await site["owner"].get(f"/api/messages/{message_id}/preview-image")
        assert answer.status == 404


class TestRefused:
    async def test_a_picture_too_large_is_left_out_and_the_preview_kept(
        self, site: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(unfurl_job, "MAX_PICTURE_BYTES", 1000)
        message_id = await post_link(site)
        preview = await preview_of(site["owner"], site["general"], message_id)
        assert preview["title"] == "Launch notes"
        assert preview["imageUrl"] is None and preview["imageWidth"] is None
        assert site["kept"] == {}

    async def test_svg_is_never_a_picture(self, site: dict[str, Any]) -> None:
        site["pages"]["/img/cover.png"] = (
            "image/svg+xml",
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        )
        message_id = await post_link(site)
        assert (await preview_of(site["owner"], site["general"], message_id))["imageUrl"] is None
        assert site["kept"] == {}

    async def test_a_picture_on_a_private_address_is_never_fetched(
        self, site: dict[str, Any]
    ) -> None:
        site["pages"]["/story"] = (
            "text/html",
            PAGE.replace(b"/img/cover.png", b"http://10.0.0.7/secret.png"),
        )
        message_id = await post_link(site)
        assert (await preview_of(site["owner"], site["general"], message_id))["imageUrl"] is None
        assert not any("10.0.0.7" in hop for hop in site["requested"])

    async def test_an_older_preview_never_hands_a_browser_a_third_party_address(
        self, site: dict[str, Any]
    ) -> None:
        message_id = await post_link(site)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE messages SET link_preview = cast(:p AS jsonb) WHERE id = :id"),
                {
                    "id": message_id,
                    "p": json.dumps(
                        {
                            "url": "https://news.example.com/story",
                            "title": "Launch notes",
                            "imageUrl": "https://tracker.example.net/pixel.png",
                        }
                    ),
                },
            )
        preview = await preview_of(site["owner"], site["general"], message_id)
        assert preview["imageUrl"] is None
