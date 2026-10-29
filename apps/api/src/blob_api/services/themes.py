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
from ..schemas.base import CamelModel

#: The tokens a theme may set, in the groups the editor shows them in. Anything else is
#: rejected rather than ignored, so a typo surfaces at save time instead of silently doing
#: nothing.
#:
#: The names are shadcn's (`apps/web/src/styles/theme.css`) plus Blob's own presence and
#: unread colours, which shadcn has no word for. The groups are written out rather than cut
#: from one long tuple by index: a new name goes into the group it belongs to, and nothing
#: after it moves. `--radius` and every other structural variable of shadcn's stays out —
#: only colour is themeable.
TOKEN_GROUPS: dict[str, tuple[str, ...]] = {
    "Surfaces": (
        "--background",
        "--card",
        "--popover",
        "--muted",
        "--secondary",
        "--accent",
        "--sidebar",
    ),
    "Text": (
        "--foreground",
        "--card-foreground",
        "--popover-foreground",
        "--muted-foreground",
        "--secondary-foreground",
        "--accent-foreground",
        "--sidebar-foreground",
    ),
    "Brand": (
        "--primary",
        "--primary-foreground",
        "--sidebar-primary",
        "--sidebar-primary-foreground",
        "--sidebar-accent",
        "--sidebar-accent-foreground",
        "--ring",
        "--sidebar-ring",
    ),
    "Lines": (
        "--border",
        "--input",
        "--sidebar-border",
    ),
    "State": (
        "--destructive",
        "--presence-online",
        "--presence-away",
        "--presence-offline",
        "--unread-line",
        "--unread-text",
    ),
    "Charts": (
        "--chart-1",
        "--chart-2",
        "--chart-3",
        "--chart-4",
        "--chart-5",
    ),
}

THEMEABLE_TOKENS: tuple[str, ...] = tuple(
    token for group in TOKEN_GROUPS.values() for token in group
)

#: A literal number: `1`, `0.54`, `.5`. Written as digits, then optionally a dot and digits,
#: rather than `\d*\.?\d+`, which matches the same strings but can split a run of digits two
#: ways at every position — quadratic time on a long value that then fails to match.
_NUM = r"(?:\d+(?:\.\d+)?|\.\d+)"

#: #rgb, #rrggbb, #rrggbbaa, an rgb()/rgba() with space or comma separators, or an
#: oklch() — shadcn's own notation — with lightness and chroma as a number or a percentage,
#: hue as a number or in degrees, and an optional alpha. Literal numbers only: no `var()`,
#: no `calc()`, no `none`, nothing that could carry a second declaration.
_COLOR_RE = re.compile(
    r"^(#[0-9a-fA-F]{3,8}"
    r"|rgba?\([0-9\s.,%/]+\)"
    rf"|oklch\(\s*{_NUM}%?\s+{_NUM}%?\s+{_NUM}(?:deg)?\s*(?:/\s*{_NUM}%?\s*)?\))$"
)

Mode = Literal["light", "dark"]


class Theme(CamelModel):
    id: str
    slug: str
    name: str
    mode: Mode
    tokens: dict[str, str]
    is_preset: bool
    is_enabled: bool


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
#:
#: A preset names only what it changes; the rest is shadcn's b0, light or dark by its mode.
#: Values are hex. Every palette is held to AA contrast on the pairs that matter — text on
#: the surface it sits on, muted text on the page, the cards, the muted wash and the
#: sidebar, the button label on its button — against b0 for whatever it leaves out, by
#: `tests/test_themes.py::test_every_preset_is_readable`.
#:
#: `ensure_presets` never rewrites a row a workspace already has, so editing a value here
#: reaches workspaces founded afterwards and nobody else. Changing one for everyone takes a
#: migration (0078 is the model: it carries its own frozen copy of these).
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
        # Nor does Midnight: it is the built-in dark one.
        "tokens": {},
    },
    {
        "slug": "high-contrast",
        "name": "High contrast",
        "mode": "light",
        "tokens": {
            "--background": "#ffffff",
            "--card": "#ffffff",
            "--popover": "#ffffff",
            "--sidebar": "#f2f2f2",
            "--foreground": "#000000",
            "--card-foreground": "#000000",
            "--popover-foreground": "#000000",
            "--muted-foreground": "#333333",
            "--accent-foreground": "#000000",
            "--sidebar-foreground": "#000000",
            "--primary": "#0b4f2f",
            "--sidebar-primary": "#0b4f2f",
            "--sidebar-accent": "#dceee5",
            "--ring": "#0b4f2f",
            "--sidebar-ring": "#0b4f2f",
            "--border": "#767676",
            "--input": "#333333",
            "--sidebar-border": "#767676",
            "--destructive": "#8a1c12",
        },
    },
    {
        "slug": "linen",
        "name": "Linen",
        "mode": "light",
        "tokens": {
            "--background": "#fbf8f3",
            "--card": "#fffdf9",
            "--popover": "#fffdf9",
            "--muted": "#f6f1e8",
            "--accent": "#f0e9dc",
            "--sidebar": "#f4eee3",
            "--muted-foreground": "#6b6b6b",
            "--primary": "#7a4f22",
            "--primary-foreground": "#fffdf9",
            "--sidebar-primary": "#7a4f22",
            "--sidebar-primary-foreground": "#fffdf9",
            "--sidebar-accent": "#f3ebe0",
            "--ring": "#7a4f22",
            "--sidebar-ring": "#7a4f22",
            "--border": "#e6ddcd",
            "--sidebar-border": "#e6ddcd",
        },
    },
    {
        "slug": "harbour",
        "name": "Harbour",
        "mode": "light",
        "tokens": {
            "--background": "#fafbfd",
            "--card": "#ffffff",
            "--popover": "#ffffff",
            "--muted": "#f1f5fa",
            "--accent": "#e6edf6",
            "--sidebar": "#eaf0f7",
            "--muted-foreground": "#6b6b6b",
            "--primary": "#14508c",
            "--primary-foreground": "#ffffff",
            "--sidebar-primary": "#14508c",
            "--sidebar-primary-foreground": "#ffffff",
            "--sidebar-accent": "#e8f0f9",
            "--ring": "#14508c",
            "--sidebar-ring": "#14508c",
            "--border": "#d9e2ee",
            "--sidebar-border": "#d9e2ee",
        },
    },
    {
        "slug": "sage",
        "name": "Sage",
        "mode": "light",
        "tokens": {
            "--background": "#f9fbf8",
            "--card": "#ffffff",
            "--popover": "#ffffff",
            "--muted": "#f2f6f1",
            "--accent": "#e8efe7",
            "--sidebar": "#ecf2ec",
            "--muted-foreground": "#6b6b6b",
            "--primary": "#2f6344",
            "--primary-foreground": "#ffffff",
            "--sidebar-primary": "#2f6344",
            "--sidebar-primary-foreground": "#ffffff",
            "--sidebar-accent": "#eaf2ec",
            "--ring": "#2f6344",
            "--sidebar-ring": "#2f6344",
            "--border": "#dbe4da",
            "--sidebar-border": "#dbe4da",
        },
    },
    {
        "slug": "blossom",
        "name": "Blossom",
        "mode": "light",
        "tokens": {
            "--background": "#fdfafc",
            "--card": "#ffffff",
            "--popover": "#ffffff",
            "--muted": "#faf1f6",
            "--accent": "#f2e4ec",
            "--sidebar": "#f6eaf1",
            "--muted-foreground": "#6b6b6b",
            "--primary": "#7d2f56",
            "--primary-foreground": "#ffffff",
            "--sidebar-primary": "#7d2f56",
            "--sidebar-primary-foreground": "#ffffff",
            "--sidebar-accent": "#f5e8f0",
            "--ring": "#7d2f56",
            "--sidebar-ring": "#7d2f56",
            "--border": "#e9d8e2",
            "--sidebar-border": "#e9d8e2",
        },
    },
    {
        "slug": "plum",
        "name": "Plum",
        "mode": "dark",
        "tokens": {
            "--background": "#17121a",
            "--card": "#211a29",
            "--popover": "#211a29",
            "--muted": "#251d2e",
            "--accent": "#2b2235",
            "--sidebar": "#1e1724",
            "--primary": "#c58ae4",
            "--primary-foreground": "#150f1a",
            "--sidebar-primary": "#c58ae4",
            "--sidebar-primary-foreground": "#150f1a",
            "--sidebar-accent": "#2a1f36",
            "--ring": "#c58ae4",
            "--sidebar-ring": "#c58ae4",
            "--border": "#332941",
            "--sidebar-border": "#332941",
        },
    },
    {
        "slug": "forest",
        "name": "Forest",
        "mode": "dark",
        "tokens": {
            "--background": "#0f1512",
            "--card": "#16201a",
            "--popover": "#16201a",
            "--muted": "#1a251e",
            "--accent": "#1f2c24",
            "--sidebar": "#141c17",
            "--primary": "#67c692",
            "--primary-foreground": "#0b120e",
            "--sidebar-primary": "#67c692",
            "--sidebar-primary-foreground": "#0b120e",
            "--sidebar-accent": "#1b2f24",
            "--ring": "#67c692",
            "--sidebar-ring": "#67c692",
            "--border": "#26362c",
            "--sidebar-border": "#26362c",
        },
    },
    {
        "slug": "carbon",
        "name": "Carbon",
        "mode": "dark",
        "tokens": {
            "--background": "#131313",
            "--card": "#1d1d1d",
            "--popover": "#1d1d1d",
            "--muted": "#212121",
            "--accent": "#272727",
            "--sidebar": "#1a1a1a",
            "--primary": "#e0a35e",
            "--primary-foreground": "#151004",
            "--sidebar-primary": "#e0a35e",
            "--sidebar-primary-foreground": "#151004",
            "--sidebar-accent": "#2b2418",
            "--ring": "#e0a35e",
            "--sidebar-ring": "#e0a35e",
            "--border": "#333333",
            "--sidebar-border": "#333333",
        },
    },
    {
        "slug": "ember",
        "name": "Ember",
        "mode": "dark",
        "tokens": {
            "--background": "#17120e",
            "--card": "#231b15",
            "--popover": "#231b15",
            "--muted": "#28201a",
            "--accent": "#2f261e",
            "--sidebar": "#1f1813",
            "--primary": "#e8935a",
            "--primary-foreground": "#160f08",
            "--sidebar-primary": "#e8935a",
            "--sidebar-primary-foreground": "#160f08",
            "--sidebar-accent": "#33241a",
            "--ring": "#e8935a",
            "--sidebar-ring": "#e8935a",
            "--border": "#3a2f25",
            "--sidebar-border": "#3a2f25",
        },
    },
    {
        "slug": "slate",
        "name": "Slate",
        "mode": "dark",
        "tokens": {
            "--background": "#101318",
            "--card": "#181d26",
            "--popover": "#181d26",
            "--muted": "#1b212b",
            "--accent": "#1f2530",
            "--sidebar": "#141820",
            "--primary": "#6aa9f0",
            "--primary-foreground": "#08111c",
            "--sidebar-primary": "#6aa9f0",
            "--sidebar-primary-foreground": "#08111c",
            "--sidebar-accent": "#16243a",
            "--ring": "#2c4a70",
            "--sidebar-ring": "#2c4a70",
            "--border": "#28303c",
            "--input": "#3a4453",
            "--sidebar-border": "#28303c",
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
                SELECT id, slug, name, mode, tokens, is_preset, is_enabled
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
                    RETURNING id, slug, name, mode, tokens, is_preset, is_enabled
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
                        RETURNING id, slug, name, mode, tokens, is_preset, is_enabled
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
