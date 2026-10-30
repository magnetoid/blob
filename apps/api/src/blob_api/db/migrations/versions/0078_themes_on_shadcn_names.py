"""Themes speak shadcn's colour names (phase 1 of the shadcn move).

A theme is a map of token name to colour, and the client now reads shadcn's names —
`--background`, `--card`, `--primary`, `--muted-foreground` — where it read Blob's own.
Left as they were, every stored theme would set names nothing reads and look like the
default. This renames each stored theme's tokens and rewrites the twelve shipped presets.

Custom themes are renamed key by key (`REKEY`). A name with one home goes there; a name
shadcn has two homes for (`--text` is the foreground of the page, the cards, the popovers,
a hover wash and the sidebar) goes to both, because the old name coloured all of them.
Several old names shared one new home — the old stylesheet had five greys for muted text
and four hover washes — so a home is filled by the first of its chain that the theme sets
(`FALLBACKS`, each chain in the order a person would have set them): `--text-3`, else
`--text-4`, `--text-5`, `--text-label`, `--text-faint` for `--muted-foreground`; `--text`,
else `--text-body`; `--bg-sidebar`, else `--bg-rail`; `--hairline`, else `--hairline-soft`,
`--hairline-popover`; `--surface-hover`, else `--surface-row-hover`, `--surface-hover-warm`,
`--surface-hover-deep`; `--surface-muted`, else `--surface-icon`. A name further down a
chain is read only when the ones above it are absent, so a theme that sets the first gets
what it always did. These 13 have no counterpart and are dropped, so a custom theme that
set one of them loses that one colour and keeps the rest:

    --text-2 --text-rail --accent-hover --accent-wash-rail --accent-wash-soft
    --accent-border-soft --avatar-bg --disabled-bg --disabled-fg --track-off --scrollbar
    --knob --backdrop

Presets are not renamed but replaced, by slug, with `PRESET_TOKENS`: a frozen copy of
`services/themes.PRESETS` as it shipped with this release, values checked for contrast
against shadcn's b0 (`tests/test_themes.py::test_every_preset_is_readable`). It is a copy
rather than an import because a migration has to mean the same thing the day somebody
edits the preset. A preset row with a slug this release does not ship is renamed like a
custom theme. Paper and Midnight are empty: they are the built-in palettes.

`--accent` is a name in both vocabularies — the brand colour before, shadcn's hover wash
after — so `rekey` first asks whether a theme already speaks the new one. A dict holding
any name the old vocabulary lacked is left alone (less what is no longer a name at all),
which makes the rewrite safe to meet twice. The one case it cannot tell apart is a
new-format theme whose keys all sit in the set both vocabularies share (`--accent`,
`--presence-*`, `--unread-*`): met a second time, its `--accent` would become `--primary`.
Nothing in a normal sequence does that — the rows are in the old vocabulary the first time
and the downgrade below puts them back in it — so it is only a re-run by hand.

`downgrade` is a best-effort inverse, because the old client cannot be left to read the
new names: it applies `--accent` in both vocabularies, so a rekeyed theme would paint its
hover wash as the brand colour, and the old server refuses to save one. Presets go back to
`OLD_PRESET_TOKENS`, a frozen copy of what `services/themes.PRESETS` held at 0077, and
every other row has each name `RESTORE` knows put back on its old one (`--card` is
`--surface`, `--primary` is `--accent`, `--accent` is `--surface-hover`). It is lossy: the
13 names above are gone for good, so are the greys and washes that shared a home (only the
first one's name comes back), `--popover` and the other second homes are discarded, and
what only the new vocabulary has (`--secondary`, `--chart-*` …) has no old name to go back
to. Run it from the new image — `alembic downgrade 0077` — before pointing anything at an
older one, which cannot boot with a database at 0078 ("Can't locate revision").

Revision ID: 0078
Revises: 0077
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping

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

#: For a home's main old name, the old names that fill it when the theme does not set that
#: one — in order, the first present wins. The old stylesheet drew muted text in five greys
#: and a hover in four washes, and the new one has one of each.
FALLBACKS: dict[str, tuple[str, ...]] = {
    "--text": ("--text-body",),
    "--text-3": ("--text-4", "--text-5", "--text-label", "--text-faint"),
    "--bg-sidebar": ("--bg-rail",),
    "--hairline": ("--hairline-soft", "--hairline-popover"),
    "--surface-hover": ("--surface-row-hover", "--surface-hover-warm", "--surface-hover-deep"),
    "--surface-muted": ("--surface-icon",),
}

#: The old names that have no new one, not even as somebody else's fallback.
DROPPED: tuple[str, ...] = tuple(
    name
    for name in OLD_NAMES
    if name not in REKEY and not any(name in chain for chain in FALLBACKS.values())
)

#: Names only the new vocabulary has: finding one means a theme is already rewritten.
_NEW_ONLY = frozenset(NEW_NAMES) - frozenset(OLD_NAMES)


def rekey(tokens: Mapping[str, str]) -> dict[str, str]:
    """A theme's tokens under shadcn's names; one that already uses them comes back as it is.

    "Already uses them" means holding at least one name only the new vocabulary has. A theme
    whose keys are all in the shared set (`--accent`, `--presence-*`, `--unread-*`) cannot
    be told from an old one and is renamed, which is only reachable by running the
    migration again by hand.
    """
    if any(name in _NEW_ONLY for name in tokens):
        return {name: value for name, value in tokens.items() if name in NEW_NAMES}
    renamed: dict[str, str] = {}
    for name, value in tokens.items():
        for home in REKEY.get(name, ()):
            renamed[home] = value
    # A main name a theme did not set may have been set under one of its fallbacks.
    for main, chain in FALLBACKS.items():
        if main in tokens:
            continue
        found = next((name for name in chain if name in tokens), None)
        if found is not None:
            for home in REKEY[main]:
                renamed[home] = tokens[found]
    return renamed


#: New name -> the old name it came from, for `downgrade`. The inverse of `REKEY` where
#: `REKEY` has one name per home; the second homes (`--popover`, `--card-foreground`,
#: `--sidebar-primary` …) are not here, so they are dropped.
RESTORE: dict[str, str] = {
    "--background": "--bg",
    "--card": "--surface",
    "--muted": "--surface-muted",
    "--accent": "--surface-hover",
    "--foreground": "--text",
    "--muted-foreground": "--text-3",
    "--border": "--hairline",
    "--input": "--hairline-strong",
    "--primary": "--accent",
    "--primary-foreground": "--accent-contrast",
    "--ring": "--accent-border",
    "--sidebar": "--bg-sidebar",
    "--sidebar-accent": "--accent-wash",
    "--destructive": "--danger",
    "--presence-online": "--presence-online",
    "--presence-away": "--presence-away",
    "--presence-offline": "--presence-offline",
    "--unread-line": "--unread-line",
    "--unread-text": "--unread-text",
}

#: Names only the old vocabulary has: finding one means a theme is already restored.
_OLD_ONLY = frozenset(OLD_NAMES) - frozenset(NEW_NAMES)


def unkey(tokens: Mapping[str, str]) -> dict[str, str]:
    """A theme's tokens back under Blob's old names; one that already uses them is kept.

    "Already uses them" means holding at least one name only the old vocabulary has, as in
    `rekey`. Names with no old counterpart are dropped. Values are not checked: an `oklch()`
    colour, which the new grammar allows and the old one did not, is carried over as it is —
    a browser draws it, though the old server would refuse to save that theme again.
    """
    if any(name in _OLD_ONLY for name in tokens):
        return {name: value for name, value in tokens.items() if name in OLD_NAMES}
    return {RESTORE[name]: value for name, value in tokens.items() if name in RESTORE}


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


#: `services/themes.PRESETS` as it stood at 0077 — the names the old client reads — by slug.
#: Frozen like `PRESET_TOKENS`, and for the same reason: what `downgrade` puts back must
#: not change when somebody edits the live presets.
OLD_PRESET_TOKENS: dict[str, dict[str, str]] = {
    "paper": {},
    "midnight": {},
    "high-contrast": {
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
    "linen": {
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
    "harbour": {
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
    "sage": {
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
    "blossom": {
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
    "plum": {
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
    "forest": {
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
    "carbon": {
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
    "ember": {
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
    "slate": {
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
}


def _convert(
    connection: sa.Connection,
    presets: Mapping[str, Mapping[str, str]],
    convert: Callable[[Mapping[str, str]], dict[str, str]],
) -> None:
    """Give every stored theme the tokens `presets` or `convert` say it should have.

    A preset row takes its slug's tokens from `presets`; any other row, and a preset whose
    slug is not in it, goes through `convert`. A row that comes out unchanged is not
    written, and nothing is committed: the caller's transaction decides.
    """
    rows = connection.execute(sa.text("SELECT id, slug, is_preset, tokens FROM themes")).fetchall()
    for row in rows:
        stored = row.tokens
        if isinstance(stored, str):
            stored = json.loads(stored)
        tokens = dict(presets[row.slug]) if row.is_preset and row.slug in presets else None
        if tokens is None:
            tokens = convert(stored or {})
        if tokens == stored:
            continue
        connection.execute(
            sa.text("UPDATE themes SET tokens = cast(:tokens AS jsonb) WHERE id = :id"),
            {"id": row.id, "tokens": json.dumps(tokens)},
        )


def rewrite_themes(connection: sa.Connection) -> None:
    """Rewrite every stored theme onto shadcn's names, on whatever connection it is given.

    A preset row takes its slug's frozen tokens from `PRESET_TOKENS`; any other row, and a
    preset whose slug is not in it, goes through `rekey`. This is `upgrade()`'s whole body,
    split out so a test can run it on its own session.
    """
    _convert(connection, PRESET_TOKENS, rekey)


def restore_themes(connection: sa.Connection) -> None:
    """Put every stored theme back on Blob's old names, as far as that can be done.

    A preset row takes its slug's tokens from `OLD_PRESET_TOKENS`; any other row, and a
    preset whose slug is not in it, goes through `unkey`. `downgrade()`'s whole body.
    """
    _convert(connection, OLD_PRESET_TOKENS, unkey)


def upgrade() -> None:
    rewrite_themes(op.get_bind())


def downgrade() -> None:
    """Best effort: the old names back where there is one, the rest dropped.

    A new name can stand for several old ones and a dozen old names were dropped outright, so
    this is not `upgrade` run backwards: a custom theme comes back with the colours the old
    client has a name for, and the presets come back exactly. See the top of the file.
    """
    restore_themes(op.get_bind())
