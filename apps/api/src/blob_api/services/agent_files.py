"""Files an agent handed over, checked and stored the way a person's upload is.

A person's upload is two requests — a ticket, then a PUT straight to storage — because
the bytes are in a browser. An agent's arrive inside its run (`blob.file.*`, folded by
`plugins/agui.py`), so the worker already holds them. What stays the same is every rule
a person's file meets on the way in: the name is checked against the same list, the bytes
are sniffed by the same function, the workspace's own limit applies, and an image gets its
thumbnail. So does the order. The row is written before the object, so a failure between
the two leaves a row the nightly orphan sweep can find — an object never outlives the only
record that it exists.

Nothing here raises for a bad file. A refused or failed file becomes a sentence the job
puts under the answer, and the answer is posted regardless: a file that did not make it
must never cost the reply it came with, and must never vanish without a word either.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from ..db.engine import transaction
from ..lib import images, magic, storage
from ..lib.ids import new_id
from . import files as file_service
from .workspace_settings import load as load_settings

log = logging.getLogger("blob.agent_files")

#: Python's own table, without the host's `/etc/mime.types`: the same name must get the
#: same type on a laptop and in the container.
_TYPES = mimetypes.MimeTypes(filenames=())

#: What that table does not know and agents commonly make.
_MORE_TYPES = {
    "yaml": "application/yaml",
    "yml": "application/yaml",
    "log": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

#: Claims that say nothing, so the name is asked instead.
_NO_CLAIM = {"", "application/octet-stream", "binary/octet-stream"}


class Handed(Protocol):
    """A file as the run handed it over — `plugins.agui.AgentFile` has this shape."""

    @property
    def name(self) -> str: ...

    @property
    def mime(self) -> str | None: ...

    @property
    def data(self) -> bytes: ...


@dataclass(slots=True)
class Stored:
    #: Rows ready to attach, uploaded and owned by the agent's bot, not yet on a message.
    attachment_ids: list[str] = field(default_factory=list)
    #: A sentence for each file that did not make it, for under the answer.
    notes: list[str] = field(default_factory=list)


def type_of(name: str, claimed: str | None) -> str:
    """The type a file is stored as: what the agent said, or what its name suggests."""
    said = magic.claimed_mime(claimed or "")
    if said not in _NO_CLAIM:
        return said
    guessed, _ = _TYPES.guess_type(name, strict=False)
    if guessed:
        return guessed
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return _MORE_TYPES.get(extension, "application/octet-stream")


async def store(*, workspace_id: str, uploader_id: str, files: Sequence[Handed]) -> Stored:
    """Check and store each file. Refusals and failures come back as notes, never raise."""
    stored = Stored()
    if not files:
        return stored
    limit = (await load_settings(workspace_id)).upload_limit_bytes
    await storage.ensure_bucket()
    for handed in files:
        refusal = _refusal(handed, limit)
        if refusal is not None:
            stored.notes.append(f"Couldn't attach `{handed.name}`: {refusal}")
            continue
        attachment_id = await _put(workspace_id, uploader_id, handed)
        if attachment_id is None:
            stored.notes.append(
                f"Couldn't attach `{handed.name}`: storage didn't take it. Asking again may work."
            )
            continue
        stored.attachment_ids.append(attachment_id)
    return stored


def _refusal(handed: Handed, limit: int) -> str | None:
    """Why this file may not be shared here, in words for a channel, or None."""
    extension = magic.blocked_extension(handed.name)
    if extension:
        return f".{extension} files can't be shared here."
    if len(handed.data) > limit:
        return "it's larger than this workspace allows."
    reason = magic.reject_reason(handed.data[: magic.HEAD_BYTES], type_of(handed.name, handed.mime))
    if reason:
        return reason[:1].lower() + reason[1:]
    return None


async def _put(workspace_id: str, uploader_id: str, handed: Handed) -> str | None:
    """Row, object, thumbnail, done — the browser path's order. None if storage failed."""
    mime = type_of(handed.name, handed.mime)
    size = len(handed.data)
    attachment_id = new_id()
    key = storage.build_object_key(workspace_id, handed.name)
    async with transaction() as (session, _):
        await file_service.open_ticket(
            session,
            workspace_id=workspace_id,
            uploader_id=uploader_id,
            attachment_id=attachment_id,
            object_key=key,
            filename=handed.name,
            mime=mime,
            size_bytes=size,
        )
    try:
        await storage.put_object(key, handed.data, mime)
    except Exception:
        # The row stays, unbound, and the orphan sweep removes it with whatever did land.
        log.warning("could not store an agent's file %s", attachment_id, exc_info=True)
        return None

    thumb_key: str | None = None
    width = height = None
    if images.can_thumbnail(mime, size):
        # Off the event loop, as the browser path does it: decoding is CPU work.
        rendered = await asyncio.to_thread(images.render, handed.data)
        if rendered is not None:
            candidate = images.thumb_key_for(key)
            try:
                await storage.put_object(candidate, rendered.thumb, rendered.thumb_mime)
                thumb_key, width, height = candidate, rendered.width, rendered.height
            except Exception:
                # An attachment with no thumbnail still works; it is only slower to show.
                log.warning("could not store a thumbnail for %s", attachment_id, exc_info=True)

    async with transaction() as (session, _):
        await file_service.mark_uploaded(
            session, attachment_id, uploader_id, width=width, height=height, thumb_key=thumb_key
        )
    return attachment_id
