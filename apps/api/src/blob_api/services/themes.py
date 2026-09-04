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


#: Shipped with the app, and the reason a person has a gallery to choose from.
#:
#: Paper is the design as drawn and Midnight is its dark twin; everything else is an
#: alternative. Themes are per person — picking one changes nobody else's screen — which
#: is what makes shipping a dozen worth doing rather than asking an admin to author them.
#: Every palette here was checked for AA contrast on the pairs that matter (body text on
#: each background, muted text on the page, sidebar text on the sidebar, and the accent
#: both on the page and against what sits on top of it) before it was added.
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
        "slug": "linen",
        "name": "Linen",
        "mode": "light",
        "tokens": {
            "--bg": "#fbf8f3",
            "--bg-sidebar": "#f4eee3",
            "--bg-rail": "#ece4d6",
            "--surface": "#fffdf9",
            "--surface-muted": "#f6f1e8",
            "--surface-hover": "#f0e9dc",
            "--surface-row-hover": "#f6f1e8",
            "--hairline": "#e6ddcd",
            "--hairline-soft": "#e6ddcd",
            "--text-rail": "#5d5347",
            "--accent": "#7a4f22",
            "--accent-hover": "#7a4f22",
            "--accent-contrast": "#fffdf9",
            "--accent-wash": "#f3ebe0",
            "--accent-wash-rail": "#f3ebe0",
            "--accent-border": "#7a4f22",
        },
    },
    {
        "slug": "harbour",
        "name": "Harbour",
        "mode": "light",
        "tokens": {
            "--bg": "#fafbfd",
            "--bg-sidebar": "#eaf0f7",
            "--bg-rail": "#dfe8f3",
            "--surface": "#ffffff",
            "--surface-muted": "#f1f5fa",
            "--surface-hover": "#e6edf6",
            "--surface-row-hover": "#f1f5fa",
            "--hairline": "#d9e2ee",
            "--hairline-soft": "#d9e2ee",
            "--text-rail": "#4a5666",
            "--accent": "#14508c",
            "--accent-hover": "#14508c",
            "--accent-contrast": "#ffffff",
            "--accent-wash": "#e8f0f9",
            "--accent-wash-rail": "#e8f0f9",
            "--accent-border": "#14508c",
        },
    },
    {
        "slug": "sage",
        "name": "Sage",
        "mode": "light",
        "tokens": {
            "--bg": "#f9fbf8",
            "--bg-sidebar": "#ecf2ec",
            "--bg-rail": "#e2eae1",
            "--surface": "#ffffff",
            "--surface-muted": "#f2f6f1",
            "--surface-hover": "#e8efe7",
            "--surface-row-hover": "#f2f6f1",
            "--hairline": "#dbe4da",
            "--hairline-soft": "#dbe4da",
            "--text-rail": "#4d5a50",
            "--accent": "#2f6344",
            "--accent-hover": "#2f6344",
            "--accent-contrast": "#ffffff",
            "--accent-wash": "#eaf2ec",
            "--accent-wash-rail": "#eaf2ec",
            "--accent-border": "#2f6344",
        },
    },
    {
        "slug": "blossom",
        "name": "Blossom",
        "mode": "light",
        "tokens": {
            "--bg": "#fdfafc",
            "--bg-sidebar": "#f6eaf1",
            "--bg-rail": "#efdde8",
            "--surface": "#ffffff",
            "--surface-muted": "#faf1f6",
            "--surface-hover": "#f2e4ec",
            "--surface-row-hover": "#faf1f6",
            "--hairline": "#e9d8e2",
            "--hairline-soft": "#e9d8e2",
            "--text-rail": "#5f4b56",
            "--accent": "#7d2f56",
            "--accent-hover": "#7d2f56",
            "--accent-contrast": "#ffffff",
            "--accent-wash": "#f5e8f0",
            "--accent-wash-rail": "#f5e8f0",
            "--accent-border": "#7d2f56",
        },
    },
    {
        "slug": "plum",
        "name": "Plum",
        "mode": "dark",
        "tokens": {
            "--bg": "#17121a",
            "--bg-sidebar": "#1e1724",
            "--bg-rail": "#120e16",
            "--surface": "#211a29",
            "--surface-muted": "#251d2e",
            "--surface-hover": "#2b2235",
            "--surface-row-hover": "#251d2e",
            "--hairline": "#332941",
            "--hairline-soft": "#332941",
            "--text-rail": "#a294ad",
            "--accent": "#c58ae4",
            "--accent-hover": "#c58ae4",
            "--accent-contrast": "#150f1a",
            "--accent-wash": "#2a1f36",
            "--accent-wash-rail": "#2a1f36",
            "--accent-border": "#c58ae4",
        },
    },
    {
        "slug": "forest",
        "name": "Forest",
        "mode": "dark",
        "tokens": {
            "--bg": "#0f1512",
            "--bg-sidebar": "#141c17",
            "--bg-rail": "#0a100c",
            "--surface": "#16201a",
            "--surface-muted": "#1a251e",
            "--surface-hover": "#1f2c24",
            "--surface-row-hover": "#1a251e",
            "--hairline": "#26362c",
            "--hairline-soft": "#26362c",
            "--text-rail": "#8ea394",
            "--accent": "#67c692",
            "--accent-hover": "#67c692",
            "--accent-contrast": "#0b120e",
            "--accent-wash": "#1b2f24",
            "--accent-wash-rail": "#1b2f24",
            "--accent-border": "#67c692",
        },
    },
    {
        "slug": "carbon",
        "name": "Carbon",
        "mode": "dark",
        "tokens": {
            "--bg": "#131313",
            "--bg-sidebar": "#1a1a1a",
            "--bg-rail": "#0e0e0e",
            "--surface": "#1d1d1d",
            "--surface-muted": "#212121",
            "--surface-hover": "#272727",
            "--surface-row-hover": "#212121",
            "--hairline": "#333333",
            "--hairline-soft": "#333333",
            "--text-rail": "#9e9e9e",
            "--accent": "#e0a35e",
            "--accent-hover": "#e0a35e",
            "--accent-contrast": "#151004",
            "--accent-wash": "#2b2418",
            "--accent-wash-rail": "#2b2418",
            "--accent-border": "#e0a35e",
        },
    },
    {
        "slug": "ember",
        "name": "Ember",
        "mode": "dark",
        "tokens": {
            "--bg": "#17120e",
            "--bg-sidebar": "#1f1813",
            "--bg-rail": "#120e0a",
            "--surface": "#231b15",
            "--surface-muted": "#28201a",
            "--surface-hover": "#2f261e",
            "--surface-row-hover": "#28201a",
            "--hairline": "#3a2f25",
            "--hairline-soft": "#3a2f25",
            "--text-rail": "#a5948a",
            "--accent": "#e8935a",
            "--accent-hover": "#e8935a",
            "--accent-contrast": "#160f08",
            "--accent-wash": "#33241a",
            "--accent-wash-rail": "#33241a",
            "--accent-border": "#e8935a",
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
    """Insert the shipped presets once per workspace. Safe to call on every boot.

    The existence check first: this runs on every /api/bootstrap, i.e. every page
    load, and unconditionally issuing one INSERT per preset opened a write
    transaction per load that almost always wrote nothing.
    """
    count = (
        await session.execute(
            text("SELECT count(*) AS n FROM themes WHERE workspace_id = :ws AND is_preset"),
            {"ws": workspace_id},
        )
    ).scalar_one()
    if count >= len(PRESETS):
        return
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
                 ORDER BY is_preset DESC, mode, lower(name) LIMIT 100
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
