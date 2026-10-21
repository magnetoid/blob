"""Link previews.

Fetches the first URL in a message and extracts its OpenGraph tags. Deliberately
defensive: an unfurl is a nice-to-have that must never hang the queue or become an SSRF
vector, so private address ranges are refused and the fetch is capped hard.

The picture a page names (`og:image`) is fetched here as well, once, by the same guarded
path, and kept as a small WebP beside the message (M3 · B3). The preview a channel draws
points at that copy through Blob and never at the page's own server: a reader's browser
fetching it there would tell a third party who read the message, and when. The picture's
address is not even stored.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

import httpx
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib import images, storage
from ..lib.net import pin_public
from ..realtime import hub
from ..services import messages as message_service

log = logging.getLogger("blob.jobs.unfurl")

FETCH_TIMEOUT_SEC = 5.0
MAX_BYTES = 512 * 1024
#: A page's picture, before it is made small. Anything larger is refused rather than cut
#: short, because a truncated image does not decode.
MAX_PICTURE_BYTES = 5 * 1024 * 1024

#: Redirect hops followed. Each one is re-checked before it is fetched.
MAX_REDIRECTS = 3

_URL_RE = re.compile(r"https?://[^\s<>\"')]+")


def first_url(body: str) -> str | None:
    match = _URL_RE.search(body)
    return match.group(0) if match else None


class _Head(HTMLParser):
    """A page's title and its meta tags, by `property` or `name`, first of each.

    The standard library's parser rather than regular expressions, because the page is
    whoever posted the link's to write. The patterns this replaced put two `[^>]+` around a
    literal, so one long tag that never closed backtracked quadratically, and a page of
    unclosed `<meta` openers did it once per opener: a worker slot held for the job's whole
    timeout by one message (the 2026-10 security review). The parser reads each character
    a bounded number of times, and stops caring once the head is over.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title: str | None = None
        self._in_title = False
        self._title: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "meta":
            named = {key.lower(): value for key, value in attrs if key}
            key = (named.get("property") or named.get("name") or "").strip().lower()
            content = named.get("content")
            if key and content and key not in self.meta:
                self.meta[key] = content.strip()[:300]
        elif tag == "title" and self.title is None:
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title).strip()[:300] or None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title.append(data)


def read_head(html: str) -> _Head:
    head = _Head()
    try:
        head.feed(html)
        head.close()
    except Exception:
        log.debug("could not parse a page for its preview", exc_info=True)
    return head


@dataclass(slots=True)
class _Fetched:
    body: bytes
    #: Where the bytes came from, after redirects — what a relative `og:image` is read
    #: against.
    url: str
    #: False when the body was cut at the limit.
    complete: bool


async def _fetch(
    raw_url: str, *, accept: str, wanted: Callable[[str], bool], limit: int
) -> _Fetched | None:
    """GET a public URL, or None. The one way this module touches the network.

    Redirects are walked by hand so every hop is checked, not just the one someone typed.
    Following them automatically meant a link to any public redirector could send this
    process to 169.254.169.254 or a service on the internal network — and because the
    title and og: tags of whatever came back are stored on the message and broadcast to
    the channel, the reply came with a read channel attached. Any member could do it with
    one message.
    """
    try:
        url = raw_url
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SEC,
            follow_redirects=False,
            headers={"user-agent": "blob-unfurl/1.0", "accept": accept},
        ) as client:
            for hop in range(MAX_REDIRECTS + 1):
                # Every hop pinned to the address its name was checked at (`net.pin_public`):
                # checking a name and then letting the client resolve it again is two DNS
                # answers, and a nameserver can make the second one the database's.
                pinned = await pin_public(url)
                if pinned is None:
                    if hop:
                        log.warning("unfurl refused a redirect into a private address")
                    return None
                async with client.stream(
                    "GET", pinned.url, headers=pinned.headers, extensions=pinned.extensions
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return None
                        # Relative targets are legal, so resolve before judging — against the
                        # name, not the address the request was pinned to.
                        url = str(httpx.URL(url).join(location))
                        continue

                    if response.status_code >= 400:
                        return None
                    if not wanted(response.headers.get("content-type", "").lower()):
                        return None

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        chunks.append(chunk)
                        total += len(chunk)
                        if total >= limit:
                            break
                    return _Fetched(b"".join(chunks)[:limit], url, complete=total < limit)
            # Ran out of hops without reaching a real page.
            return None
    except httpx.HTTPError:
        return None


async def fetch_unfurl(raw_url: str) -> dict[str, Any] | None:
    fetched = await _fetch(
        raw_url, accept="text/html", wanted=lambda kind: "text/html" in kind, limit=MAX_BYTES
    )
    if fetched is None:
        return None
    head = read_head(fetched.body.decode("utf-8", errors="replace"))
    meta = head.meta
    return {
        "url": raw_url,
        "title": meta.get("og:title") or head.title,
        "description": meta.get("og:description") or meta.get("description"),
        "imageUrl": _absolute(meta.get("og:image") or meta.get("twitter:image"), fetched.url),
        "siteName": meta.get("og:site_name"),
    }


def _absolute(picture: str | None, page_url: str) -> str | None:
    """A picture's address as a page wrote it — often relative — read against the page."""
    if not picture:
        return None
    try:
        joined = str(httpx.URL(page_url).join(picture))
    except httpx.InvalidURL:
        return None
    return joined if joined.startswith(("https://", "http://")) else None


async def fetch_picture(url: str) -> images.Rendered | None:
    """The page's picture, fetched by the guarded path and made small, or None. Never SVG:
    it is a document that can carry script, not a picture, and Pillow could not read it
    anyway."""
    fetched = await _fetch(
        url,
        accept="image/avif,image/webp,image/png,image/jpeg,image/gif",
        wanted=lambda kind: kind.startswith("image/") and "svg" not in kind,
        limit=MAX_PICTURE_BYTES,
    )
    if fetched is None or not fetched.complete:
        return None
    return await asyncio.to_thread(images.render, fetched.body)


def picture_key(workspace_id: str, message_id: str) -> str:
    return f"{workspace_id}/link-previews/{message_id}.webp"


async def _keep_picture(url: str, *, workspace_id: str, message_id: str) -> dict[str, Any]:
    rendered = await fetch_picture(url)
    if rendered is None:
        return {}
    key = picture_key(workspace_id, message_id)
    try:
        await storage.put_object(key, rendered.thumb, images.THUMB_MIME)
    except Exception:
        # A preview without its picture is still a preview.
        log.warning("could not keep the picture for %s", message_id, exc_info=True)
        return {}
    return {"imageKey": key, "imageWidth": rendered.width, "imageHeight": rendered.height}


async def handle_unfurl(message_id: str) -> None:
    # Read, then fetch with no connection held — two remote fetches of up to five seconds
    # each are no time to keep a Postgres connection out of the pool — then write.
    async with session_scope() as session:
        message = (
            await session.execute(
                text(
                    """
                    SELECT m.body, m.channel_id, c.workspace_id
                      FROM messages m JOIN channels c ON c.id = m.channel_id
                     WHERE m.id = :id AND m.deleted_at IS NULL
                    """
                ),
                {"id": message_id},
            )
        ).fetchone()
    if message is None:
        return

    url = first_url(message.body)
    if not url:
        return

    preview = await fetch_unfurl(url)
    if not preview or not preview.get("title"):
        return

    picture = preview.pop("imageUrl", None)
    if picture:
        preview.update(
            await _keep_picture(
                picture, workspace_id=str(message.workspace_id), message_id=message_id
            )
        )

    async with transaction() as (session, after):
        written = (
            await session.execute(
                text(
                    """
                    UPDATE messages SET link_preview = cast(:preview AS jsonb)
                     WHERE id = :id AND deleted_at IS NULL
                    RETURNING id
                    """
                ),
                {"id": message_id, "preview": json.dumps(preview)},
            )
        ).fetchone()
        if written is None:
            return
        updated = await message_service.by_id(session, message_id)
        if updated is not None:
            channel_id = message.channel_id
            after.add(
                lambda: hub.to_channel(
                    channel_id,
                    {"t": "message.updated", "message": updated.model_dump(by_alias=True)},
                )
            )
