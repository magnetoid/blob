"""Uploads and downloads.

The browser uploads straight to object storage with a presigned PUT — file bytes never
pass through this process. Downloads redirect to a short-lived presigned GET, so stored
message payloads hold a stable URL rather than an expiring one.
"""

from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id
from ..lib.rate_limit import consume
from ..lib.storage import build_object_key, ensure_bucket, presign_download, presign_upload
from ..schemas.base import CamelModel
from ..schemas.requests import UploadCompleteInput, UploadRequestInput

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


class OkOut(CamelModel):
    ok: bool = True


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

    attachment_id = new_id()
    object_key = build_object_key(user.workspace_id, payload.filename)

    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                INSERT INTO attachments
                  (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes)
                VALUES (:id, :ws, :uploader_id, :object_key, :filename, :mime, :size_bytes)
                """
            ),
            {
                "id": attachment_id,
                "ws": user.workspace_id,
                "uploader_id": user.id,
                "object_key": object_key,
                "filename": payload.filename,
                "mime": payload.mime,
                "size_bytes": payload.size_bytes,
            },
        )

    return UploadTicket(
        attachment_id=attachment_id,
        upload_url=presign_upload(object_key, payload.mime),
        headers={"Content-Type": payload.mime},
    )


@router.post("/api/uploads/{attachment_id}/complete", response_model=OkOut)
async def complete_upload(
    attachment_id: str,
    payload: UploadCompleteInput | None = None,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    """Step 2: tell us the upload finished (and, for images, how big it is)."""
    payload = payload or UploadCompleteInput()

    async with transaction() as (session, _):
        rows = (
            await session.execute(
                text(
                    """
                    UPDATE attachments
                       SET uploaded_at = now(),
                           width = COALESCE(:width, width),
                           height = COALESCE(:height, height)
                     WHERE id = :id AND uploader_id = :uploader_id
                    RETURNING id
                    """
                ),
                {
                    "id": attachment_id,
                    "uploader_id": user.id,
                    "width": payload.width,
                    "height": payload.height,
                },
            )
        ).fetchall()
    if not rows:
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
        raise not_found("No such file.")

    async with session_scope() as session:
        file = (
            await session.execute(
                text(
                    """
                    SELECT a.filename, a.mime, a.message_id, a.uploader_id,
                           cm.user_id AS channel_member
                      FROM attachments a
                      LEFT JOIN messages m ON m.id = a.message_id
                      LEFT JOIN channel_members cm
                             ON cm.channel_id = m.channel_id AND cm.user_id = :user_id
                     WHERE a.object_key = :key AND a.workspace_id = :ws
                    """
                ),
                {"key": key, "user_id": user.id, "ws": user.workspace_id},
            )
        ).fetchone()

        if file is None:
            # Avatars and custom emoji are workspace-wide and have no attachment row.
            shared = (
                await session.execute(
                    text(
                        """
                        SELECT object_key AS key FROM custom_emoji
                         WHERE workspace_id = :ws AND object_key = :key
                        UNION ALL
                        SELECT avatar_key FROM users
                         WHERE workspace_id = :ws AND avatar_key = :key
                        """
                    ),
                    {"ws": user.workspace_id, "key": key},
                )
            ).fetchone()
            if shared is None:
                raise not_found("No such file.")
            return RedirectResponse(presign_download(key, mime="image/png"), status_code=302)

    allowed = file.channel_member is not None if file.message_id else file.uploader_id == user.id
    if not allowed:
        raise not_found("No such file.")

    return RedirectResponse(
        presign_download(key, filename=file.filename, mime=file.mime), status_code=302
    )


__all__ = ["router"]
