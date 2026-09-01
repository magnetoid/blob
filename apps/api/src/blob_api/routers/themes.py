"""Themes: listing for everyone, editing for admins."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.ids import IdParam
from ..schemas.base import CamelModel
from ..services import audit as audit_service
from ..services import themes as theme_service
from ..services.audit import actor_for
from ..services.themes import Theme

router = APIRouter(tags=["themes"])


class ThemesOut(CamelModel):
    themes: list[Theme]
    #: The token names a theme may set, grouped the way the editor renders them.
    groups: dict[str, list[str]]


class ThemeOut(CamelModel):
    theme: Theme


class SaveThemeInput(CamelModel):
    id: str | None = None
    name: str
    mode: str
    tokens: dict[str, str]
    is_enabled: bool = True


class OkOut(CamelModel):
    ok: bool = True


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return slug or "theme"


@router.get("/api/themes", response_model=ThemesOut)
async def list_themes(user: SessionUser = Depends(current_user)) -> ThemesOut:
    async with session_scope() as session:
        themes = await theme_service.list_themes(session, user.workspace_id)
    return ThemesOut(
        themes=themes,
        groups={name: list(tokens) for name, tokens in theme_service.TOKEN_GROUPS.items()},
    )


@router.put("/api/admin/themes", response_model=ThemeOut)
async def save_theme(
    payload: SaveThemeInput, request: Request, admin: SessionUser = Depends(require_admin)
) -> ThemeOut:
    async with transaction() as (session, _):
        theme = await theme_service.save_theme(
            session,
            admin.workspace_id,
            admin.id,
            theme_id=payload.id,
            slug=slugify(payload.name),
            name=payload.name,
            mode="dark" if payload.mode == "dark" else "light",
            tokens=payload.tokens,
            is_enabled=payload.is_enabled,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "theme.saved",
            target_type="theme",
            target_id=theme.id,
            metadata={"name": theme.name, "tokens": len(theme.tokens)},
        )
    return ThemeOut(theme=theme)


@router.delete("/api/admin/themes/{theme_id}", response_model=OkOut)
async def delete_theme(
    theme_id: IdParam, request: Request, admin: SessionUser = Depends(require_admin)
) -> OkOut:
    async with transaction() as (session, _):
        await theme_service.delete_theme(session, admin.workspace_id, theme_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "theme.deleted",
            target_type="theme",
            target_id=theme_id,
        )
    return OkOut()


__all__ = ["router"]
