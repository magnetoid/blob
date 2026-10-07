"""The files in a conversation, as an agent that speaks AG-UI 1.0 is shown them.

AG-UI 1.0 lets a user message carry content parts — text, images, documents — beside its
text. So the files people shared in the conversation an agent is asked in travel with the
run: an image as an image, a PDF as a document, a text file as its text. Until this, an
agent asked "what does this chart show?" was handed the question and not the chart.

**Inline, never by URL.** The agent may have no route to this server's storage — a
socket agent on a laptop, a container on a network of its own — and a URL into private
storage would have to carry a credential that outlives the run. Base64 in the request
costs bytes and nothing else, so the bytes are what is bounded.

**Bounded, newest first.** The files nearest the question are the ones it is about, so
the history is read from its end: at most `PARTS_MAX` files, none over `PART_MAX_BYTES`,
`PARTS_MAX_BYTES` in all. A file over a bound is still *named* in its message's text
(`agui.to_agui_messages` says "[attached: …]" for every file), so the agent knows it
exists even when it is not handed it.

**Only for an agent that said it speaks 1.0** (`agui.speaks`). An older parser refuses a
list where it expects text, and a refused run reads exactly like an agent that is down.

Never fatal: a file that cannot be read from storage is left out and logged, and the run
goes ahead with the rest.
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Sequence
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope
from ..lib import storage
from ..schemas.models import Attachment, Message

log = logging.getLogger("blob.jobs.agui")

#: Files one run is handed, all messages together.
PARTS_MAX = 6
#: The largest single file handed over, in bytes.
PART_MAX_BYTES = 2 * 1024 * 1024
#: All the files of one run together, in bytes, before base64.
PARTS_MAX_BYTES = 6 * 1024 * 1024
#: How much of a text file is handed over, in characters.
TEXT_PART_MAX_CHARS = 64_000

IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
DOCUMENT_TYPES = frozenset({"application/pdf"})
TEXT_TYPES = frozenset({"text/plain", "text/markdown", "text/csv", "application/json"})


def _type_of(attachment: Attachment) -> str:
    return attachment.mime.split(";", 1)[0].strip().lower()


def _candidates(history: Sequence[Message], bot_user_id: str) -> list[tuple[str, Attachment]]:
    """The files worth handing over, newest message first, as (message id, attachment)."""
    found: list[tuple[str, Attachment]] = []
    for message in reversed(history):
        if message.deleted_at or message.kind == "system" or message.author_id == bot_user_id:
            continue
        for attachment in message.attachments:
            if attachment.kind == "voice":
                continue  # Its transcript is already the message's text.
            kind = _type_of(attachment)
            if kind not in IMAGE_TYPES | DOCUMENT_TYPES | TEXT_TYPES:
                continue
            if attachment.size_bytes > PART_MAX_BYTES:
                continue
            found.append((message.id, attachment))
            if len(found) >= PARTS_MAX:
                return found
    return found


def _part(attachment: Attachment, data: bytes) -> dict[str, Any] | None:
    kind = _type_of(attachment)
    if kind in TEXT_TYPES:
        try:
            body = data.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return {"type": "text", "text": f"{attachment.filename}:\n{body[:TEXT_PART_MAX_CHARS]}"}
    source = {"type": "data", "value": base64.b64encode(data).decode("ascii"), "mimeType": kind}
    return {
        "type": "image" if kind in IMAGE_TYPES else "document",
        "source": source,
        "metadata": {"filename": attachment.filename},
    }


async def attachment_parts(
    history: Sequence[Message], *, bot_user_id: str
) -> dict[str, list[dict[str, Any]]]:
    """Content parts for the files in `history`, keyed by the id of the message they
    came with. Empty when there is nothing to hand over.

    Reads storage with no database session open: the keys are looked up in one short
    session first, then the objects fetched one by one.
    """
    candidates = _candidates(history, bot_user_id)
    if not candidates:
        return {}
    async with session_scope() as session:
        rows = (
            await session.execute(
                text("SELECT id, object_key FROM attachments WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": [attachment.id for _, attachment in candidates]},
            )
        ).fetchall()
    keys = {str(row.id): str(row.object_key) for row in rows}

    parts: dict[str, list[dict[str, Any]]] = {}
    budget = PARTS_MAX_BYTES
    for message_id, attachment in candidates:
        key = keys.get(attachment.id)
        if key is None or attachment.size_bytes > budget:
            continue
        try:
            data = await storage.get_object(key)
        except Exception:
            log.info("agui: could not read %s for an agent; left out", attachment.id, exc_info=True)
            continue
        if len(data) > PART_MAX_BYTES or len(data) > budget:
            continue
        part = _part(attachment, data)
        if part is None:
            continue
        budget -= len(data)
        parts.setdefault(message_id, []).append(part)
    return parts


__all__ = [
    "PARTS_MAX",
    "PARTS_MAX_BYTES",
    "PART_MAX_BYTES",
    "TEXT_PART_MAX_CHARS",
    "attachment_parts",
]
