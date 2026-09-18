"""The attachment rows behind uploads, downloads and the files tab.

The bytes never pass through this process — the browser PUTs to object storage on a
presigned URL and GETs on another — so what the server keeps is the row: who uploaded
what, where it sits, and which message carries it. Authorization for a download is
membership of the channel the file was posted in; an unattached file is visible only to
whoever uploaded it, and avatars and custom emoji are workspace-wide.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..lib.errors import no_such_file


async def listing(
    session: AsyncSession,
    user: SessionUser,
    *,
    channel_id: str | None,
    kind: str,
    cursor: str | None,
    limit: int,
    #: Case-insensitive substring of the filename. None means no filter — `''` would
    #: match every row through the LIKE and is normalised away in the router.
    q: str | None = None,
) -> tuple[list[Any], str | None]:
    """Files posted in channels this person can see, newest first, keyset-paged.

    Unattached uploads (still in flight) stay off this list. Asking for a channel the
    person is not in answers as if there were no such file — the same 404 the channel
    itself would give.
    """
    if channel_id:
        member = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM channel_members
                     WHERE channel_id = :channel_id AND user_id = :user_id
                    """
                ),
                {"channel_id": channel_id, "user_id": user.id},
            )
        ).fetchone()
        if member is None:
            raise no_such_file()

    rows = (
        await session.execute(
            text(
                """
                SELECT a.id, a.filename, a.mime, a.size_bytes, a.width, a.height,
                       a.object_key, a.thumb_key, a.message_id, m.channel_id,
                       a.created_at, a.kind, a.duration_ms, a.waveform,
                       a.transcript_status, a.transcript_provider
                  FROM attachments a
                  JOIN messages m ON m.id = a.message_id
                  JOIN channel_members cm
                         ON cm.channel_id = m.channel_id AND cm.user_id = :user_id
                 WHERE a.workspace_id = :ws
                   AND (
                        CAST(:channel_id AS uuid) IS NULL
                        OR m.channel_id = CAST(:channel_id AS uuid)
                   )
                   AND (
                        :kind = 'all'
                        OR (:kind = 'image' AND a.mime LIKE 'image/%')
                        OR (:kind = 'voice' AND a.kind = 'voice')
                        -- Voice messages are their own tab, so they leave this one:
                        -- otherwise every recording lands under Files as `voice-169...`.
                        OR (:kind = 'file' AND a.mime NOT LIKE 'image/%' AND a.kind = 'file')
                   )
                   AND (
                        CAST(:q AS text) IS NULL
                        OR a.filename ILIKE '%' || CAST(:q AS text) || '%'
                   )
                   AND (
                        CAST(:cursor AS uuid) IS NULL
                        OR (a.created_at, a.id) < (
                            SELECT created_at, id FROM attachments
                             WHERE id = CAST(:cursor AS uuid)
                        )
                   )
                 ORDER BY a.created_at DESC, a.id DESC
                 LIMIT :limit
                """
            ),
            {
                "ws": user.workspace_id,
                "user_id": user.id,
                "channel_id": channel_id,
                "kind": kind,
                "q": q,
                "cursor": cursor,
                "limit": limit + 1,
            },
        )
    ).fetchall()
    page = list(rows[:limit])
    return page, (page[-1].id if len(rows) > limit else None)


async def open_ticket(
    session: AsyncSession,
    user: SessionUser,
    *,
    attachment_id: str,
    object_key: str,
    filename: str,
    mime: str,
    size_bytes: int,
    kind: str = "file",
) -> None:
    """The row an upload ticket is written against, before any byte has moved."""
    await session.execute(
        text(
            """
            INSERT INTO attachments
              (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes, kind)
            VALUES (:id, :ws, :uploader_id, :object_key, :filename, :mime, :size_bytes, :kind)
            """
        ),
        {
            "id": attachment_id,
            "ws": user.workspace_id,
            "uploader_id": user.id,
            "object_key": object_key,
            "filename": filename,
            "mime": mime,
            "size_bytes": size_bytes,
            "kind": kind,
        },
    )


async def own_upload(session: AsyncSession, attachment_id: str, uploader_id: str) -> Any:
    """An upload as its uploader sees it; None when it is not theirs or is gone."""
    return (
        await session.execute(
            text(
                """
                SELECT object_key, mime, size_bytes, thumb_key, uploaded_at, kind
                  FROM attachments
                 WHERE id = :id AND uploader_id = :uploader_id
                """
            ),
            {"id": attachment_id, "uploader_id": uploader_id},
        )
    ).fetchone()


async def refuse_upload(session: AsyncSession, attachment_id: str, uploader_id: str) -> None:
    await session.execute(
        text("DELETE FROM attachments WHERE id = :id AND uploader_id = :uploader_id"),
        {"id": attachment_id, "uploader_id": uploader_id},
    )


async def mark_uploaded(
    session: AsyncSession,
    attachment_id: str,
    uploader_id: str,
    *,
    width: int | None,
    height: int | None,
    thumb_key: str | None,
    duration_ms: int | None = None,
    waveform: list[int] | None = None,
) -> bool:
    """Record that the bytes arrived. False when the row is not this uploader's."""
    rows = (
        await session.execute(
            text(
                """
                UPDATE attachments
                   SET uploaded_at = now(),
                       width = COALESCE(:width, width),
                       height = COALESCE(:height, height),
                       thumb_key = COALESCE(:thumb_key, thumb_key),
                       duration_ms = COALESCE(:duration_ms, duration_ms),
                       waveform = COALESCE(cast(:waveform AS jsonb), waveform)
                 WHERE id = :id AND uploader_id = :uploader_id
                RETURNING id
                """
            ),
            {
                "id": attachment_id,
                "uploader_id": uploader_id,
                "width": width,
                "height": height,
                "thumb_key": thumb_key,
                "duration_ms": duration_ms,
                "waveform": json.dumps(waveform) if waveform is not None else None,
            },
        )
    ).fetchall()
    return bool(rows)


async def for_download(session: AsyncSession, user: SessionUser, key: str) -> Any:
    """The attachment behind a stored key, with whether this person is in its channel.

    A thumbnail is the same attachment and answers to the same rule: one row, either of
    its two keys.
    """
    return (
        await session.execute(
            text(
                """
                SELECT a.filename, a.mime, a.message_id, a.uploader_id,
                       a.thumb_key, a.kind, cm.user_id AS channel_member
                  FROM attachments a
                  LEFT JOIN messages m ON m.id = a.message_id
                  LEFT JOIN channel_members cm
                         ON cm.channel_id = m.channel_id AND cm.user_id = :user_id
                 WHERE (a.object_key = :key OR a.thumb_key = :key)
                   AND a.workspace_id = :ws
                """
            ),
            {"key": key, "user_id": user.id, "ws": user.workspace_id},
        )
    ).fetchone()


async def is_shared_picture(session: AsyncSession, workspace_id: str, key: str) -> bool:
    """Avatars and custom emoji are workspace-wide, whatever their upload row says."""
    row = (
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
            {"ws": workspace_id, "key": key},
        )
    ).fetchone()
    return row is not None
