"""Themes speak shadcn's colour names (phase 1 of the shadcn move).

A theme is a map of token name to colour, and the client now reads shadcn's names —
`--background`, `--card`, `--primary`, `--muted-foreground` — where it read Blob's own.
Left as they were, every stored theme would set names nothing reads and look like the
default. This renames each stored theme's tokens and rewrites the twelve shipped presets.

Custom themes are renamed key by key (`REKEY`). A name with one home goes there; a name
shadcn has two homes for (`--text` is the foreground of the page, the cards, the popovers,
a hover wash and the sidebar) goes to both, because the old name coloured all of them.
These 25 have no counterpart and are dropped, so a custom theme that set one of them loses
that one colour and keeps the rest:

    --bg-rail --surface-hover-warm --surface-hover-deep --surface-row-hover
    --surface-icon --hairline-soft --hairline-popover --text-body --text-2 --text-4
    --text-5 --text-label --text-faint --text-rail --accent-hover --accent-wash-rail
    --accent-wash-soft --accent-border-soft --avatar-bg --disabled-bg --disabled-fg
    --track-off --scrollbar --knob --backdrop

Presets are not renamed but replaced, by slug, with `PRESET_TOKENS`: a frozen copy of
`services/themes.PRESETS` as it shipped with this release, values checked for contrast
against shadcn's b0 (`tests/test_themes.py::test_every_preset_is_readable`). It is a copy
rather than an import because a migration has to mean the same thing the day somebody
edits the preset. A preset row with a slug this release does not ship is renamed like a
custom theme. Paper and Midnight are empty: they are the built-in palettes.

`--accent` is a name in both vocabularies — the brand colour before, shadcn's hover wash
after — so `rekey` first asks whether a theme already speaks the new one. A dict holding
any name the old vocabulary lacked is left alone (less what is no longer a name at all),
which makes the rewrite safe to meet twice: `downgrade` cannot undo it, and an `alembic
downgrade` followed by an `upgrade` would otherwise turn a hover wash into a brand colour.
The one case it cannot tell apart is a new-format theme whose keys all sit in the set both
vocabularies share (`--accent`, `--presence-*`, `--unread-*`): on a re-run that reads as an
old theme and its `--accent` becomes `--primary`. It is reachable only through downgrade
followed by upgrade, and only for a theme saved after this release with no other colour.

Revision ID: 0078
Revises: 0077
"""

from __future__ import annotations

import json
from collections.abc import Mapping

import sqlalchemy as sa
from alembic import op

revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None

#: Every colour name a theme could set before this release.
OLD_NAMES: tuple[str, ...] = (
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
    "--hairline",
    "--hairline-soft",
    "--hairline-strong",
    "--hairline-popover",
    "--text",
    "--text-body",
    "--text-2",
    "--text-3",
    "--text-4",
    "--text-5",
    "--text-label",
    "--text-faint",
    "--text-rail",
    "--accent",
    "--accent-hover",
    "--accent-contrast",
    "--accent-wash",
    "--accent-wash-rail",
    "--accent-wash-soft",
    "--accent-border",
    "--accent-border-soft",
    "--avatar-bg",
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

#: Every colour name a theme may set from this release on (`services/themes.py`, frozen).
NEW_NAMES: tuple[str, ...] = (
    "--background",
    "--card",
    "--popover",
    "--muted",
    "--secondary",
    "--accent",
    "--sidebar",
    "--foreground",
    "--card-foreground",
    "--popover-foreground",
    "--muted-foreground",
    "--secondary-foreground",
    "--accent-foreground",
    "--sidebar-foreground",
    "--primary",
    "--primary-foreground",
    "--sidebar-primary",
    "--sidebar-primary-foreground",
    "--sidebar-accent",
    "--sidebar-accent-foreground",
    "--ring",
    "--sidebar-ring",
    "--border",
    "--input",
    "--sidebar-border",
    "--destructive",
    "--presence-online",
    "--presence-away",
    "--presence-offline",
    "--unread-line",
    "--unread-text",
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
)

#: Old name -> the new names that now do its job.
REKEY: dict[str, tuple[str, ...]] = {
    "--bg": ("--background",),
    "--surface": ("--card", "--popover"),
    "--surface-muted": ("--muted",),
    "--surface-hover": ("--accent",),
    "--text": (
        "--foreground",
        "--card-foreground",
        "--popover-foreground",
        "--accent-foreground",
        "--sidebar-foreground",
    ),
    "--text-3": ("--muted-foreground",),
    "--hairline": ("--border", "--sidebar-border"),
    "--hairline-strong": ("--input",),
    "--accent": ("--primary", "--sidebar-primary"),
    "--accent-contrast": ("--primary-foreground", "--sidebar-primary-foreground"),
    "--accent-border": ("--ring", "--sidebar-ring"),
    "--bg-sidebar": ("--sidebar",),
    "--accent-wash": ("--sidebar-accent",),
    "--danger": ("--destructive",),
    "--presence-online": ("--presence-online",),
    "--presence-away": ("--presence-away",),
    "--presence-offline": ("--presence-offline",),
    "--unread-line": ("--unread-line",),
    "--unread-text": ("--unread-text",),
}

#: The old names that have no new one.
DROPPED: tuple[str, ...] = tuple(name for name in OLD_NAMES if name not in REKEY)

#: Names only the new vocabulary has: finding one means a theme is already rewritten.
_NEW_ONLY = frozenset(NEW_NAMES) - frozenset(OLD_NAMES)


def rekey(tokens: Mapping[str, str]) -> dict[str, str]:
    """A theme's tokens under shadcn's names; one that already uses them comes back as it is.

    "Already uses them" means holding at least one name only the new vocabulary has. A theme
    whose keys are all in the shared set (`--accent`, `--presence-*`, `--unread-*`) cannot
    be told from an old one and is renamed, which is only reachable by running the
    migration again after a downgrade.
    """
    if any(name in _NEW_ONLY for name in tokens):
        return {name: value for name, value in tokens.items() if name in NEW_NAMES}
    renamed: dict[str, str] = {}
    for name, value in tokens.items():
        for home in REKEY.get(name, ()):
            renamed[home] = value
    return renamed


#: `services/themes.PRESETS` as it shipped with this release, by slug. Frozen: see the top.
PRESET_TOKENS: dict[str, dict[str, str]] = {
    "paper": {},
    "midnight": {},
    "high-contrast": {
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
    "linen": {
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
        "--destructive": "#d8000b",
    },
    "harbour": {
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
        "--destructive": "#d9000b",
    },
    "sage": {
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
        "--destructive": "#da000b",
    },
    "blossom": {
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
        "--destructive": "#d7000b",
    },
    "plum": {
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
    "forest": {
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
    "carbon": {
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
    "ember": {
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
    "slate": {
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
        "--ring": "#6aa9f0",
        "--sidebar-ring": "#6aa9f0",
        "--border": "#28303c",
        "--input": "#3a4453",
        "--sidebar-border": "#28303c",
    },
}


def rewrite_themes(connection: sa.Connection) -> None:
    """Rewrite every stored theme onto shadcn's names, on whatever connection it is given.

    A preset row takes its slug's frozen tokens from `PRESET_TOKENS`; any other row, and a
    preset whose slug is not in it, goes through `rekey`. A row that comes out unchanged is
    not written. This is `upgrade()`'s whole body, split out so a test can run it on its
    own session, and it commits nothing: the caller's transaction decides.
    """
    rows = connection.execute(sa.text("SELECT id, slug, is_preset, tokens FROM themes")).fetchall()
    for row in rows:
        stored = row.tokens
        if isinstance(stored, str):
            stored = json.loads(stored)
        tokens = PRESET_TOKENS[row.slug] if row.is_preset and row.slug in PRESET_TOKENS else None
        if tokens is None:
            tokens = rekey(stored or {})
        if tokens == stored:
            continue
        connection.execute(
            sa.text("UPDATE themes SET tokens = cast(:tokens AS jsonb) WHERE id = :id"),
            {"id": row.id, "tokens": json.dumps(tokens)},
        )


def upgrade() -> None:
    rewrite_themes(op.get_bind())


def downgrade() -> None:
    """Nothing to do, because the old names cannot be reconstructed.

    A new name can stand for several old ones (`--foreground` was `--text`, and
    `--card-foreground` too) and 25 old names were dropped outright, so there is no
    inverse. Stored themes stay on the new names, which the old client would ignore.
    """
