"""Link previews.

Fetches the first URL in a message and extracts its OpenGraph tags. Deliberately
defensive: an unfurl is a nice-to-have that must never hang the queue or become an SSRF
vector, so private address ranges are refused and the fetch is capped hard.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from sqlalchemy import text

from ..db.engine import transaction
from ..lib.net import pin_public
from ..realtime import hub
from ..services import messages as message_service

log = logging.getLogger("blob.jobs.unfurl")

FETCH_TIMEOUT_SEC = 5.0
MAX_BYTES = 512 * 1024

#: Redirect hops followed. Each one is re-checked before it is fetched.
MAX_REDIRECTS = 3

_URL_RE = re.compile(r"https?://[^\s<>\"')]+")
_TITLE_RE = re.compile(r"<title[^>]*>([^<]*)</title>", re.IGNORECASE)


def first_url(body: str) -> str | None:
    match = _URL_RE.search(body)
    return match.group(0) if match else None


def _meta(html: str, prop: str) -> str | None:
    patterns = [
        rf"<meta[^>]+(?:property|name)=[\"']{re.escape(prop)}[\"'][^>]+content=[\"']([^\"']*)[\"']",
        rf"<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']{re.escape(prop)}[\"']",
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match and match.group(1):
            return _decode_entities(match.group(1))[:300]
    return None


def _decode_entities(value: str) -> str:
    import html as html_module

    return html_module.unescape(value)


async def fetch_unfurl(raw_url: str) -> dict[str, Any] | None:
    try:
        # Redirects are walked by hand so every hop is checked, not just the one someone
        # typed. Following them automatically meant a link to any public redirector could
        # send this process to 169.254.169.254 or a service on the internal network — and
        # because the title and og: tags of whatever came back are stored on the message
        # and broadcast to the channel, the reply came with a read channel attached. Any
        # member could do it with one message.
        url = raw_url
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SEC,
            follow_redirects=False,
            headers={"user-agent": "blob-unfurl/1.0", "accept": "text/html"},
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
                    if "text/html" not in response.headers.get("content-type", ""):
                        return None

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        chunks.append(chunk)
                        total += len(chunk)
                        if total >= MAX_BYTES:
                            break
                    html = b"".join(chunks)[:MAX_BYTES].decode("utf-8", errors="replace")
                    break
            else:
                # Ran out of hops without reaching a real page.
                return None
    except (httpx.HTTPError, UnicodeDecodeError):
        return None

    title_tag = _TITLE_RE.search(html)
    return {
        "url": raw_url,
        "title": _meta(html, "og:title")
        or (_decode_entities(title_tag.group(1)).strip()[:300] if title_tag else None),
        "description": _meta(html, "og:description") or _meta(html, "description"),
        "imageUrl": _meta(html, "og:image"),
        "siteName": _meta(html, "og:site_name"),
    }


async def handle_unfurl(message_id: str) -> None:
    async with transaction() as (session, after):
        message = (
            await session.execute(
                text("SELECT body, channel_id FROM messages WHERE id = :id AND deleted_at IS NULL"),
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

        await session.execute(
            text("UPDATE messages SET link_preview = cast(:preview AS jsonb) WHERE id = :id"),
            {"id": message_id, "preview": json.dumps(preview)},
        )
        updated = await message_service.by_id(session, message_id)
        if updated is not None:
            channel_id = message.channel_id
            after.add(
                lambda: hub.to_channel(
                    channel_id,
                    {"t": "message.updated", "message": updated.model_dump(by_alias=True)},
                )
            )
