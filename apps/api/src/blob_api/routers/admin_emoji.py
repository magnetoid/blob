"""Custom emoji: the workspace's own vocabulary.

Split from the workspace console file by audience of *size* rather than of privilege —
same `require_admin` gate, but the emoji CRUD carries its own upload handling and
nothing else in the console needs any of it.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin
from ..lib.errors import bad_request, not_found
from ..schemas.base import CamelModel, OkOut, iso
from ..services import audit as audit_service
from ..services import emoji as emoji_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin")

#: A shortcode without its colons. Deliberately the same shape `markdown.tsx` matches, or
#: an admin could add an emoji that no message is able to reference.
EMOJI_NAME_RE = re.compile(r"^[a-z0-9_+-]{2,32}$")


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
        rows = await emoji_service.list_for_workspace(session, admin.workspace_id)

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
        object_key = await emoji_service.add(
            session, admin, name=name, attachment_id=payload.attachment_id
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
        url=f"/api/files/{object_key}",
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
        if not await emoji_service.remove(session, admin.workspace_id, name.strip(":").lower()):
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
