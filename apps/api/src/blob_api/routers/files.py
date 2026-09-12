"""Uploads and downloads.

The browser uploads straight to object storage with a presigned PUT — file bytes never
pass through this process. Downloads redirect to a short-lived presigned GET, so stored
message payloads hold a stable URL rather than an expiring one. The rows are
`services/files.py`'s; what stays here is the choreography with object storage: the
ticket, the type check on what actually arrived, the thumbnail, the redirect.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse

from ..db.engine import session_scope, transaction
from ..lib import images, magic
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, no_such_file, not_found
from ..lib.ids import IdParam, looks_like_id, new_id
from ..lib.rate_limit import consume
from ..lib.storage import (
    build_object_key,
    delete_object,
    ensure_bucket,
    get_object,
    get_object_head,
    presign_download,
    presign_upload,
    public_file_url,
    put_object,
)
from ..schemas.base import CamelModel, OkOut
from ..schemas.models import Attachment
from ..schemas.requests import UploadCompleteInput, UploadRequestInput
from ..services import files as file_service
from ..services.workspace_settings import load as load_settings

log = logging.getLogger("blob.files")

router = APIRouter(tags=["files"])

#: Extensions we refuse outright — executables and inline-scriptable formats.
BLOCKED_EXTENSIONS = {
    "exe",
    "msi",
    "bat",
    "cmd",
    "com",
    "scr",
    "ps1",
    "sh",
    "app",
    "jar",
    "svg",
    "html",
    "htm",
}


class UploadTicket(CamelModel):
    attachment_id: str
    upload_url: str
    method: str = "PUT"
    headers: dict[str, str]


class FileEntry(Attachment):
    channel_id: str
    message_id: str
    created_at: str


class FileListOut(CamelModel):
    items: list[FileEntry]
    next_cursor: str | None = None


def _file_entry(row: Any) -> FileEntry:
    thumb = row.thumb_key
    created = row.created_at
    created_at = created.isoformat() if hasattr(created, "isoformat") else str(created)
    return FileEntry(
        id=row.id,
        filename=row.filename,
        mime=row.mime,
        size_bytes=int(row.size_bytes),
        width=row.width,
        height=row.height,
        url=public_file_url(row.object_key),
        thumb_url=public_file_url(thumb) if thumb else None,
        channel_id=row.channel_id,
        message_id=row.message_id,
        created_at=created_at,
    )


@router.get("/api/attachments", response_model=FileListOut)
async def list_attachments(
    user: SessionUser = Depends(current_user),
    channel_id: str | None = Query(None, alias="channelId"),
    kind: str = Query("all"),
    cursor: str | None = None,
    limit: int = Query(40, ge=1, le=100),
) -> FileListOut:
    """Files posted in channels this person can see, newest first.

    Thumbnails stay on `thumbUrl`. The original is only fetched when somebody opens one.
    """
    if kind not in {"all", "image", "file"}:
        raise bad_request("kind must be all, image, or file.")
    if channel_id and not looks_like_id(channel_id):
        raise no_such_file()
    if cursor and not looks_like_id(cursor):
        raise bad_request("That files cursor is not one we issued.")

    async with session_scope() as session:
        page, next_cursor = await file_service.listing(
            session, user, channel_id=channel_id, kind=kind, cursor=cursor, limit=limit
        )
    return FileListOut(items=[_file_entry(row) for row in page], next_cursor=next_cursor)


@router.post("/api/uploads", response_model=UploadTicket)
async def create_upload(
    payload: UploadRequestInput, user: SessionUser = Depends(current_user)
) -> UploadTicket:
    """Step 1: ask for somewhere to put the file."""
    await consume("upload", user.id)
    await ensure_bucket()

    extension = payload.filename.rsplit(".", 1)[-1].lower() if "." in payload.filename else ""
    if extension in BLOCKED_EXTENSIONS:
        raise bad_request(f".{extension} files can't be shared here.")
    limits = await load_settings(user.workspace_id)
    if payload.size_bytes > limits.upload_limit_bytes:
        raise bad_request("That file is too large for this workspace.")

    attachment_id = new_id()
    object_key = build_object_key(user.workspace_id, payload.filename)
    async with transaction() as (session, _):
        await file_service.open_ticket(
            session,
            user,
            attachment_id=attachment_id,
            object_key=object_key,
            filename=payload.filename,
            mime=payload.mime,
            size_bytes=payload.size_bytes,
        )
    return UploadTicket(
        attachment_id=attachment_id,
        upload_url=presign_upload(object_key, payload.mime),
        headers={"Content-Type": payload.mime},
    )


@router.post("/api/uploads/{attachment_id}/complete", response_model=OkOut)
async def complete_upload(
    attachment_id: IdParam,
    payload: UploadCompleteInput | None = None,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    """Step 2: tell us the upload finished (and, for images, how big it is).

    This is also where an image gets its thumbnail. Here rather than in the worker
    because an attachment is completed *before* the message that carries it is sent, so
    by the time anybody can see the image its small copy already exists — no second
    broadcast, no row that is briefly wrong. The cost is that this request waits on a
    download, a resize and an upload; the browser has just finished uploading the
    original, so it is a fraction of what the person already waited for, and a failure
    anywhere in it leaves an attachment that works and simply has no thumbnail.
    """
    payload = payload or UploadCompleteInput()
    # The same bucket the ticket spent. This route downloads, decodes and re-encodes an
    # image, so it is the most expensive thing an authenticated caller can ask for, and
    # it had no limit of its own at all.
    await consume("upload", user.id)

    async with session_scope() as session:
        attachment = await file_service.own_upload(session, attachment_id, user.id)
    if attachment is None:
        raise not_found("That upload has expired.")

    # Completing twice is a retry, not a second upload. Without this each repeat paid for
    # the whole download-decode-encode again and overwrote a thumbnail with an identical
    # one — free work for anyone who asked for it in a loop.
    if attachment.uploaded_at is not None:
        return OkOut()

    try:
        head = await get_object_head(attachment.object_key, magic.HEAD_BYTES)
    except Exception:
        log.warning("could not read %s to check its type", attachment_id, exc_info=True)
        head = b""
    if head:
        reason = magic.reject_reason(head, attachment.mime)
        if reason:
            try:
                await delete_object(attachment.object_key)
            except Exception:
                log.warning("could not delete a refused upload %s", attachment_id, exc_info=True)
            async with transaction() as (session, _):
                await file_service.refuse_upload(session, attachment_id, user.id)
            raise bad_request(reason)

    thumb_key: str | None = None
    width, height = payload.width, payload.height
    if images.can_thumbnail(attachment.mime, attachment.size_bytes or 0):
        # Outside every transaction: two round trips to object storage.
        try:
            # Off the event loop. Decoding and resizing is CPU work measured in hundreds
            # of milliseconds for a phone photo, and on the loop it stalls every other
            # request this process is serving — including the socket writes. Every
            # sibling in `lib/storage.py` is wrapped for the same reason.
            source = await get_object(attachment.object_key)
            rendered = await asyncio.to_thread(images.render, source)
        except Exception:
            log.warning("could not read %s back for a thumbnail", attachment_id, exc_info=True)
            rendered = None
        if rendered is not None:
            key = images.thumb_key_for(attachment.object_key)
            try:
                await put_object(key, rendered.thumb, rendered.thumb_mime)
                thumb_key = key
                # The server's own measurement beats the client's: it is what the pixels
                # say after the orientation tag has been applied.
                width, height = rendered.width, rendered.height
            except Exception:
                log.warning("could not store the thumbnail for %s", attachment_id, exc_info=True)

    async with transaction() as (session, _):
        recorded = await file_service.mark_uploaded(
            session, attachment_id, user.id, width=width, height=height, thumb_key=thumb_key
        )
    if not recorded:
        raise not_found("That upload has expired.")
    return OkOut()


@router.get("/api/files/{object_key:path}")
async def download(object_key: str, user: SessionUser = Depends(current_user)) -> RedirectResponse:
    """Stable download URL.

    Authorization is by membership of the channel the file was posted in; an unattached
    file is visible only to whoever uploaded it.
    """
    key = unquote(object_key)
    if not key:
        raise no_such_file()

    async with session_scope() as session:
        file = await file_service.for_download(session, user, key)
        allowed = file is not None and (
            file.channel_member is not None if file.message_id else file.uploader_id == user.id
        )
        if not allowed:
            # Avatars and custom emoji are workspace-wide. Checked when the attachment
            # branch says no as well as when there is no attachment row at all: an
            # avatar keeps its upload row, and answering for the row alone made a
            # person's own picture a 404 to everyone but them.
            if not await file_service.is_shared_picture(session, user.workspace_id, key):
                raise no_such_file()
            return _redirect(presign_download(key, mime="image/png"))

    assert file is not None  # allowed implies a row
    if file.thumb_key == key:
        # Inline, and its own type: the thumbnail is a WebP whatever the original was.
        return _redirect(presign_download(key, mime=images.THUMB_MIME))
    return _redirect(presign_download(key, filename=file.filename, mime=file.mime))


def _redirect(url: str) -> RedirectResponse:
    """The 302 itself is cacheable even though the presigned URL behind it expires.

    A channel with twenty images re-requests every one of them on each visit without
    this; `private` keeps a shared proxy from serving one person's authorization
    decision to another.
    """
    response = RedirectResponse(url, status_code=302)
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


__all__ = ["router"]
