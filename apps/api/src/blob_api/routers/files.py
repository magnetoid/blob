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
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse, Response, StreamingResponse

from ..db.engine import session_scope, transaction
from ..lib import images, magic, previews
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, no_preview, no_such_file, not_found, preview_too_large
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
    stream_object,
)
from ..schemas.base import CamelModel, OkOut
from ..schemas.models import Attachment
from ..schemas.requests import UploadCompleteInput, UploadRequestInput
from ..services import files as file_service
from ..services.workspace_settings import load as load_settings

log = logging.getLogger("blob.files")

router = APIRouter(tags=["files"])


#: The most text the side panel will show. Past this a file is downloaded rather than read
#: in a panel: its bytes pass through this process, and a document nobody could scroll to
#: the end of is not a preview.
TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

#: Text of every kind — a page included — leaves here as inert plain text. The client
#: decides whether it is markdown, a table or a page, and a page runs only in the
#: sandboxed frame (ADR 0014), never as this response: opened directly, it is words.
_TEXT_PREVIEW_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
}

#: A web page's policy, in the header where nothing the page contains can reach it.
#: `sandbox allow-scripts` without `allow-same-origin` makes it an opaque origin however
#: it is opened — framed by the panel or navigated to directly — so it never runs as this
#: origin: no cookies, no storage, no request to the workspace as the person. The rest is
#: ADR 0014's preview policy: draw itself, run its own inline scripts, touch no network,
#: be framed by this origin alone.
_PAGE_POLICY = (
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; img-src data: https:; font-src data:; media-src data:; "
    "connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; "
    "frame-ancestors 'self'"
)

_PAGE_HEADERS = {
    "Content-Security-Policy": _PAGE_POLICY,
    # Every other response says DENY; the panel frames this one.
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
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
        kind=getattr(row, "kind", None) or "file",
        duration_ms=getattr(row, "duration_ms", None),
        waveform=getattr(row, "waveform", None),
        transcript_status=getattr(row, "transcript_status", None) or "none",
        transcript_provider=getattr(row, "transcript_provider", None),
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
    q: str | None = Query(None, max_length=100),
) -> FileListOut:
    """Files posted in channels this person can see, newest first.

    Thumbnails stay on `thumbUrl`. The original is only fetched when somebody opens one.
    """
    if kind not in {"all", "image", "file", "voice"}:
        raise bad_request("kind must be all, image, file, or voice.")
    if channel_id and not looks_like_id(channel_id):
        raise no_such_file()
    if cursor and not looks_like_id(cursor):
        raise bad_request("That files cursor is not one we issued.")

    # Blank is absent: `''` would go into the LIKE as '%%' and match everything, which
    # is the same answer but a sequential scan to get there.
    needle = q.strip() if q else None

    async with session_scope() as session:
        page, next_cursor = await file_service.listing(
            session,
            user,
            channel_id=channel_id,
            kind=kind,
            cursor=cursor,
            limit=limit,
            q=needle or None,
        )
    return FileListOut(items=[_file_entry(row) for row in page], next_cursor=next_cursor)


@router.post("/api/uploads", response_model=UploadTicket)
async def create_upload(
    payload: UploadRequestInput, user: SessionUser = Depends(current_user)
) -> UploadTicket:
    """Step 1: ask for somewhere to put the file."""
    await consume("upload", user.id)
    await ensure_bucket()

    extension = magic.blocked_extension(payload.filename)
    if extension:
        raise bad_request(f".{extension} files can't be shared here.")
    mime = payload.mime
    if payload.kind == "voice":
        # The bare type, never `audio/webm;codecs=opus`: the presigned URL pins one
        # `ContentType` and the browser has to PUT the same string, and the allowlist
        # this checks against is written in bare types.
        mime = magic.claimed_mime(payload.mime)
        if mime not in magic.AUDIO_MIME:
            raise bad_request(
                "A voice message has to be webm, mp4/m4a, ogg, mp3, wav or aac audio."
            )
    limits = await load_settings(user.workspace_id)
    if payload.size_bytes > limits.upload_limit_bytes:
        raise bad_request("That file is too large for this workspace.")

    attachment_id = new_id()
    object_key = build_object_key(user.workspace_id, payload.filename)
    async with transaction() as (session, _):
        await file_service.open_ticket(
            session,
            workspace_id=user.workspace_id,
            uploader_id=user.id,
            attachment_id=attachment_id,
            object_key=object_key,
            filename=payload.filename,
            mime=mime,
            size_bytes=payload.size_bytes,
            kind=payload.kind,
        )
    return UploadTicket(
        attachment_id=attachment_id,
        upload_url=presign_upload(object_key, mime),
        headers={"Content-Type": mime},
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

    if attachment.kind == "voice" and payload.duration_ms is None:
        raise bad_request("A voice message needs its length.")

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
            session,
            attachment_id,
            user.id,
            width=width,
            height=height,
            thumb_key=thumb_key,
            duration_ms=payload.duration_ms,
            waveform=payload.waveform,
        )
    if not recorded:
        raise not_found("That upload has expired.")
    return OkOut()


@router.get("/api/attachments/{attachment_id}/preview", response_model=None)
async def preview(attachment_id: IdParam, user: SessionUser = Depends(current_user)) -> Response:
    """A file as the side panel shows it: its text, or its PDF — nothing else, and
    nothing that could run.

    One of two routes where a file's bytes pass through this process on their way to a
    browser (the other is `page`). A download stays a redirect to storage; a preview
    cannot be one, because its headers are the point — text has to arrive as inert
    `text/plain` whatever it was uploaded as, and a PDF has to be framable by this origin
    and no other, which storage cannot be told. Who may look is the download rule,
    unchanged.
    """
    file = await _previewable(user, attachment_id)
    kind = previews.kind_of(file.filename, file.mime)
    if kind == "text":
        return Response(
            content=await _words(file),
            media_type="text/plain; charset=utf-8",
            headers=_TEXT_PREVIEW_HEADERS,
        )
    if kind == "pdf":
        # By its bytes, not its name: a `.pdf` that is not one has nothing to show.
        if not (await get_object_head(file.object_key, 5)).startswith(b"%PDF-"):
            raise no_preview()
        length, chunks = await stream_object(file.object_key)
        headers = {
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(file.filename, safe='')}",
            # Every other response says DENY. The panel frames this one, so this one says
            # this origin may — and only this origin.
            "X-Frame-Options": "SAMEORIGIN",
            "Content-Security-Policy": "frame-ancestors 'self'",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        }
        if length:
            headers["Content-Length"] = str(length)
        return StreamingResponse(chunks, media_type="application/pdf", headers=headers)
    raise no_preview()


@router.get("/api/attachments/{attachment_id}/page", response_model=None)
async def page(attachment_id: IdParam, user: SessionUser = Depends(current_user)) -> Response:
    """A web page, served as itself for the side panel to frame — in a sandbox, always.

    The panel cannot draw a page's text into a `srcdoc` frame the way it draws a picture:
    a `srcdoc` document inherits the app's own policy, and `script-src 'self'` refuses
    every inline script a page has. From here the only policy is `_PAGE_POLICY`, which
    the page cannot edit because it is a header, and whose `sandbox` holds however the
    URL is opened.
    """
    file = await _previewable(user, attachment_id)
    if not previews.is_page(file.filename, file.mime):
        raise no_preview()
    return Response(
        content=await _words(file), media_type="text/html; charset=utf-8", headers=_PAGE_HEADERS
    )


async def _previewable(user: SessionUser, attachment_id: str) -> Any:
    """The attachment, if this person may look at it — the download rule — or 404."""
    await consume("preview", user.id)
    async with session_scope() as session:
        file = await file_service.for_preview(session, user, attachment_id)
    allowed = (
        file is not None
        and file.uploaded_at is not None
        and (file.channel_member is not None if file.message_id else file.uploader_id == user.id)
    )
    if not allowed:
        raise no_such_file()
    return file


async def _words(file: Any) -> str:
    """A file's text, if it is short enough to show and is text at all.

    Measured, not trusted. The row's size is what the uploader declared for the ticket,
    and the presigned PUT does not pin it, so the read asks storage for one byte past the
    cap and no more: a file that lied about being small costs this process the cap, not
    whatever was actually uploaded.
    """
    if int(file.size_bytes or 0) > TEXT_PREVIEW_MAX_BYTES:
        raise preview_too_large()
    body = await get_object_head(file.object_key, TEXT_PREVIEW_MAX_BYTES + 1)
    if len(body) > TEXT_PREVIEW_MAX_BYTES:
        raise preview_too_large()
    try:
        return body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise no_preview() from None


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
    return _redirect(
        presign_download(key, filename=file.filename, mime=file.mime, voice=file.kind == "voice")
    )


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
