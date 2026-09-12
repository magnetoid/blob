"""Custom emoji: the workspace's own vocabulary, and the rows behind the console's CRUD.

An emoji reuses the ordinary upload flow — same ticket, same presign, same rate limit —
and then a name is attached to the object. The image is left in storage when the name
is removed: reactions already given keep their stored value, and a body that says
`:name:` falls back to the text, which is what an unknown shortcode has always done.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..lib.errors import bad_request, conflict, not_found


async def list_for_workspace(session: AsyncSession, workspace_id: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT e.name, e.object_key, e.created_at, u.display_name AS author
                      FROM custom_emoji e
                      LEFT JOIN users u ON u.id = e.created_by
                     WHERE e.workspace_id = :ws
                     ORDER BY e.name
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    )


async def add(session: AsyncSession, admin: SessionUser, *, name: str, attachment_id: str) -> str:
    """Name an image the admin uploaded. Returns the object key `:name:` now resolves to."""
    attachment = (
        await session.execute(
            text(
                """
                SELECT object_key, mime FROM attachments
                 WHERE id = :id AND workspace_id = :ws AND uploader_id = :uploader
                """
            ),
            {"id": attachment_id, "ws": admin.workspace_id, "uploader": admin.id},
        )
    ).fetchone()
    if attachment is None:
        raise not_found("That upload is not available.")
    if not str(attachment.mime).startswith("image/"):
        raise bad_request("An emoji has to be an image.", code="invalid_input")

    clash = (
        await session.execute(
            text("SELECT 1 FROM custom_emoji WHERE workspace_id = :ws AND name = :name"),
            {"ws": admin.workspace_id, "name": name},
        )
    ).fetchone()
    if clash is not None:
        raise conflict(f":{name}: is already taken here.", code="name_taken")

    await session.execute(
        text(
            """
            INSERT INTO custom_emoji (workspace_id, name, object_key, created_by)
            VALUES (:ws, :name, :key, :by)
            """
        ),
        {"ws": admin.workspace_id, "name": name, "key": attachment.object_key, "by": admin.id},
    )
    return str(attachment.object_key)


async def remove(session: AsyncSession, workspace_id: str, name: str) -> bool:
    """Take a name out of circulation. False when there was no such emoji."""
    removed = (
        await session.execute(
            text(
                """
                DELETE FROM custom_emoji
                 WHERE workspace_id = :ws AND name = :name
                RETURNING name
                """
            ),
            {"ws": workspace_id, "name": name},
        )
    ).fetchone()
    return removed is not None
