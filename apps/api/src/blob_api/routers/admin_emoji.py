"""Custom emoji: the workspace's own vocabulary.

Split from the workspace console file by audience of *size* rather than of privilege —
same `require_admin` gate, but the emoji CRUD carries its own upload handling and
nothing else in the console needs any of it.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import bad_request, conflict, not_found
from ..schemas.base import CamelModel, iso
from ..services import audit as audit_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin")

#: A shortcode without its colons. Deliberately the same shape `markdown.tsx` matches, or
#: an admin could add an emoji that no message is able to reference.
EMOJI_NAME_RE = re.compile(r"^[a-z0-9_+-]{2,32}$")


class OkOut(CamelModel):
    ok: bool = True


class CustomEmojiOut(CamelModel):
    name: str
    url: str
    created_by_name: str | None = None
    created_at: str


class CustomEmojiListOut(CamelModel):
    emoji: list[CustomEmojiOut]


class AddEmojiInput(CamelModel):
    name: str
    #: An already-uploaded attachment. Emoji reuse the ordinary upload flow rather than
    #: having one of their own — same ticket, same presign, same rate limit.
    attachment_id: str


@router.get("/emoji", response_model=CustomEmojiListOut)
async def list_custom_emoji(admin: SessionUser = Depends(require_admin)) -> CustomEmojiListOut:
    async with session_scope() as session:
        rows = (
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
                {"ws": admin.workspace_id},
            )
        ).fetchall()

    return CustomEmojiListOut(
        emoji=[
            CustomEmojiOut(
                name=row.name,
                url=f"/api/files/{row.object_key}",
                created_by_name=row.author,
                created_at=iso(row.created_at),
            )
            for row in rows
        ]
    )


@router.post("/emoji", response_model=CustomEmojiOut, status_code=201)
async def add_custom_emoji(
    payload: AddEmojiInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> CustomEmojiOut:
    """Name an uploaded image so `:name:` resolves to it.

    The workspace has had custom emoji since the beginning — the table, the bootstrap
    payload, the file route and the picker all existed. There was simply no way to add
    one, so the feature was complete apart from its entrance.
    """
    name = payload.name.strip().strip(":").lower()
    if not EMOJI_NAME_RE.match(name):
        raise bad_request(
            "An emoji name is 2-32 characters: lowercase letters, numbers, "
            "underscores, plus and hyphen.",
            code="invalid_input",
        )

    async with transaction() as (session, _):
        attachment = (
            await session.execute(
                text(
                    """
                    SELECT object_key, mime FROM attachments
                     WHERE id = :id AND workspace_id = :ws AND uploader_id = :uploader
                    """
                ),
                {"id": payload.attachment_id, "ws": admin.workspace_id, "uploader": admin.id},
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
            {
                "ws": admin.workspace_id,
                "name": name,
                "key": attachment.object_key,
                "by": admin.id,
            },
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "emoji.added",
            target_type="emoji",
            metadata={"name": name},
        )

    return CustomEmojiOut(
        name=name,
        url=f"/api/files/{attachment.object_key}",
        created_by_name=admin.display_name,
        created_at=iso(datetime.now(UTC)),
    )


@router.delete("/emoji/{name}", response_model=OkOut)
async def remove_custom_emoji(
    name: str, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    """Take a name out of circulation.

    The image is left in storage. Reactions already given keep their stored value, and a
    body that says `:name:` falls back to rendering the text — which is what an unknown
    shortcode has always done, so removing one degrades rather than breaks.
    """
    async with transaction() as (session, _):
        removed = (
            await session.execute(
                text(
                    """
                    DELETE FROM custom_emoji
                     WHERE workspace_id = :ws AND name = :name
                     RETURNING name
                    """
                ),
                {"ws": admin.workspace_id, "name": name.strip(":").lower()},
            )
        ).fetchone()
        if removed is None:
            raise not_found("No such emoji.")
        await audit_service.record(
            session,
            actor_for(request, admin),
            "emoji.removed",
            target_type="emoji",
            metadata={"name": name},
        )
    return OkOut()


__all__ = ["router"]
