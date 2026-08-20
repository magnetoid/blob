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
from urllib.parse import urlparse

import httpx
from sqlalchemy import text

from ..db.engine import transaction
from ..lib.net import is_private_host
from ..realtime import hub
from ..services import messages as message_service

log = logging.getLogger("blob.jobs.unfurl")

FETCH_TIMEOUT_SEC = 5.0
MAX_BYTES = 512 * 1024

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
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if await is_private_host(parsed.hostname):
        return None

    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SEC,
            follow_redirects=True,
            max_redirects=3,
            headers={"user-agent": "blob-unfurl/1.0", "accept": "text/html"},
        ) as client:
            async with client.stream("GET", raw_url) as response:
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
