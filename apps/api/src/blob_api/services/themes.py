"""Themes.

A theme is a named set of token overrides on top of the built-in defaults, with a mode
of light or dark. Users keep their `light | dark | system` preference; what a theme
changes is *which* palette fills each side.

Tokens are data, never CSS text: keys are checked against an allowlist and values against
a strict grammar, so a theme cannot smuggle a declaration into the page.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, conflict, forbidden, not_found
from ..lib.ids import new_id
from ..schemas.base import CamelModel, require_iso

#: Every token a theme may set. Anything else is rejected rather than ignored, so a
#: typo surfaces at save time instead of silently doing nothing.
THEMEABLE_TOKENS = (
    # surfaces
    "--bg",
    "--bg-rail",
    "--bg-sidebar",
    "--surface",
    "--surface-hover",
    "--surface-hover-warm",
    "--surface-hover-deep",
    "--surface-row-hover",
    "--surface-muted",
    "--surface-icon",
    # hairlines
    "--hairline",
    "--hairline-soft",
    "--hairline-strong",
    "--hairline-popover",
    # text
    "--text",
    "--text-body",
    "--text-2",
    "--text-3",
    "--text-4",
    "--text-5",
    "--text-label",
    "--text-faint",
    "--text-rail",
    # accent
    "--accent",
    "--accent-hover",
    "--accent-contrast",
    "--accent-wash",
    "--accent-wash-rail",
    "--accent-wash-soft",
    "--accent-border",
    "--accent-border-soft",
    "--avatar-bg",
    # state
    "--presence-online",
    "--presence-away",
    "--presence-offline",
    "--unread-line",
    "--unread-text",
    "--danger",
    "--disabled-bg",
    "--disabled-fg",
    "--track-off",
    "--scrollbar",
    "--knob",
    "--backdrop",
)

TOKEN_GROUPS: dict[str, tuple[str, ...]] = {
    "Surfaces": THEMEABLE_TOKENS[0:10],
    "Lines": THEMEABLE_TOKENS[10:14],
    "Text": THEMEABLE_TOKENS[14:23],
    "Accent": THEMEABLE_TOKENS[23:32],
    "State": THEMEABLE_TOKENS[32:],
}

#: #rgb, #rrggbb, #rrggbbaa, or an rgb()/rgba() with space or comma separators.
_COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\([0-9\s.,%/]+\))$")

Mode = Literal["light", "dark"]


class Theme(CamelModel):
    id: str
    slug: str
    name: str
    mode: Mode
    tokens: dict[str, str]
    is_preset: bool
    is_enabled: bool
    created_at: str


def validate_tokens(tokens: dict[str, Any]) -> dict[str, str]:
    """Reject unknown keys and anything that is not plainly a colour."""
    clean: dict[str, str] = {}
    for key, value in tokens.items():
        if key not in THEMEABLE_TOKENS:
            raise bad_request(f"{key} is not a themeable token.", "invalid_token")
        if not isinstance(value, str) or not _COLOR_RE.match(value.strip()):
            raise bad_request(f"{key} must be a colour, not “{value}”.", "invalid_token")
        clean[key] = value.strip()
    return clean


#: Shipped with the app. Paper is the design as drawn; the other two are alternatives.
PRESETS: list[dict[str, Any]] = [
    {
        "slug": "paper",
        "name": "Paper",
        "mode": "light",
        # No overrides: Paper *is* the built-in light palette.
        "tokens": {},
    },
    {
        "slug": "midnight",
        "name": "Midnight",
        "mode": "dark",
        "tokens": {},
    },
    {
        "slug": "high-contrast",
        "name": "High contrast",
        "mode": "light",
        "tokens": {
            "--bg": "#ffffff",
            "--surface": "#ffffff",
            "--bg-sidebar": "#f2f2f2",
            "--bg-rail": "#e8e8e8",
            "--text": "#000000",
            "--text-body": "#000000",
            "--text-2": "#1a1a1a",
            "--text-3": "#333333",
            "--text-4": "#404040",
            "--text-5": "#404040",
            "--text-label": "#333333",
            "--text-faint": "#4d4d4d",
            "--hairline": "#767676",
            "--hairline-soft": "#8c8c8c",
            "--hairline-strong": "#333333",
            "--accent": "#0b4f2f",
            "--accent-hover": "#063a22",
            "--accent-wash": "#dceee5",
            "--accent-border": "#0b4f2f",
            "--danger": "#8a1c12",
        },
    },
    {
        "slug": "slate",
        "name": "Slate",
        "mode": "dark",
        "tokens": {
            "--bg": "#101318",
            "--bg-rail": "#0b0e12",
            "--bg-sidebar": "#141820",
            "--surface": "#181d26",
            "--surface-hover": "#1f2530",
            "--surface-hover-warm": "#1f2530",
            "--surface-hover-deep": "#262d3a",
            "--surface-row-hover": "#151a22",
            "--surface-muted": "#1b212b",
            "--surface-icon": "#222936",
            "--hairline": "#28303c",
            "--hairline-soft": "#212834",
            "--hairline-strong": "#3a4453",
            "--accent": "#6aa9f0",
            "--accent-hover": "#8dbef5",
            "--accent-contrast": "#08111c",
            "--accent-wash": "#16243a",
            "--accent-wash-rail": "#1a2b45",
            "--accent-border": "#2c4a70",
            "--avatar-bg": "#213349",
        },
    },
]


def _row_to_theme(row: Any) -> Theme:
    return Theme(
        id=row.id,
        slug=row.slug,
        name=row.name,
        mode=row.mode,
        tokens=row.tokens or {},
        is_preset=row.is_preset,
        is_enabled=row.is_enabled,
        created_at=require_iso(row.created_at),
    )


async def ensure_presets(session: AsyncSession, workspace_id: str) -> None:
    """Insert the shipped presets once per workspace. Safe to call on every boot."""
    for preset in PRESETS:
        await session.execute(
            text(
                """
                INSERT INTO themes (id, workspace_id, slug, name, mode, tokens, is_preset)
                VALUES (:id, :ws, :slug, :name, :mode, cast(:tokens AS jsonb), true)
                ON CONFLICT (workspace_id, slug) DO NOTHING
                """
            ),
            {
                "id": new_id(),
                "ws": workspace_id,
                "slug": preset["slug"],
                "name": preset["name"],
                "mode": preset["mode"],
                "tokens": json.dumps(preset["tokens"]),
            },
        )


async def list_themes(session: AsyncSession, workspace_id: str) -> list[Theme]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, slug, name, mode, tokens, is_preset, is_enabled, created_at
                  FROM themes WHERE workspace_id = :ws
                 ORDER BY is_preset DESC, mode, lower(name)
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return [_row_to_theme(row) for row in rows]


async def save_theme(
    session: AsyncSession,
    workspace_id: str,
    created_by: str,
    *,
    theme_id: str | None,
    slug: str,
    name: str,
    mode: Mode,
    tokens: dict[str, Any],
    is_enabled: bool = True,
) -> Theme:
    clean = validate_tokens(tokens)

    if theme_id:
        existing = (
            await session.execute(
                text("SELECT is_preset FROM themes WHERE id = :id AND workspace_id = :ws"),
                {"id": theme_id, "ws": workspace_id},
            )
        ).fetchone()
        if existing is None:
            raise not_found("That theme no longer exists.")
        if existing.is_preset:
            raise forbidden("Presets cannot be edited. Duplicate it first.")

        row = (
            await session.execute(
                text(
                    """
                    UPDATE themes
                       SET name = :name, mode = :mode, tokens = cast(:tokens AS jsonb),
                           is_enabled = :is_enabled
                     WHERE id = :id AND workspace_id = :ws
                    RETURNING id, slug, name, mode, tokens, is_preset, is_enabled, created_at
                    """
                ),
                {
                    "id": theme_id,
                    "ws": workspace_id,
                    "name": name,
                    "mode": mode,
                    "tokens": json.dumps(clean),
                    "is_enabled": is_enabled,
                },
            )
        ).fetchone()
    else:
        try:
            row = (
                await session.execute(
                    text(
                        """
                        INSERT INTO themes
                          (id, workspace_id, slug, name, mode, tokens, created_by)
                        VALUES (:id, :ws, :slug, :name, :mode, cast(:tokens AS jsonb), :by)
                        RETURNING id, slug, name, mode, tokens, is_preset, is_enabled,
                                  created_at
                        """
                    ),
                    {
                        "id": new_id(),
                        "ws": workspace_id,
                        "slug": slug,
                        "name": name,
                        "mode": mode,
                        "tokens": json.dumps(clean),
                        "by": created_by,
                    },
                )
            ).fetchone()
        except Exception as exc:
            if "themes_slug_uniq" in str(exc) or "duplicate key" in str(exc):
                raise conflict(f"A theme called “{name}” already exists.") from exc
            raise

    if row is None:
        raise not_found("That theme no longer exists.")
    return _row_to_theme(row)


async def delete_theme(session: AsyncSession, workspace_id: str, theme_id: str) -> None:
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM themes
                 WHERE id = :id AND workspace_id = :ws AND is_preset = false
                RETURNING id
                """
            ),
            {"id": theme_id, "ws": workspace_id},
        )
    ).fetchall()
    if not rows:
        raise not_found("That theme is a preset, or already gone.")
