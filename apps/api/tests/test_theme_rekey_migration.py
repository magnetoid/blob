"""Migration 0078 moves every stored theme onto shadcn's colour names.

A theme's tokens are keyed by name and the client reads them by name, so a row written
under the old vocabulary would set nothing at all after the client moved. The migration
renames what has a home, drops what has none, and rewrites the shipped presets to the
values this release ships — and the rename has to be safe to meet twice, because
`--accent` is a name in both vocabularies.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.services.themes import PRESETS, THEMEABLE_TOKENS

from .helpers import Client, sign_up

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "blob_api"
    / "db"
    / "migrations"
    / "versions"
    / "0078_themes_on_shadcn_names.py"
)


@pytest.fixture(scope="module")
def migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0078", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ─── the rename ───────────────────────────────────────────────────────────────
def test_rekey_maps_old_names(migration: ModuleType) -> None:
    assert migration.rekey({"--bg": "#fff", "--accent": "#1f5c3d", "--text": "#111"}) == {
        "--background": "#fff",
        "--primary": "#1f5c3d",
        "--sidebar-primary": "#1f5c3d",
        "--foreground": "#111",
        "--card-foreground": "#111",
        "--popover-foreground": "#111",
        "--accent-foreground": "#111",
        "--sidebar-foreground": "#111",
    }


def test_rekey_maps_every_name_that_has_a_home(migration: ModuleType) -> None:
    old = {
        "--bg": ("--background",),
        "--surface": ("--card", "--popover"),
        "--surface-muted": ("--muted",),
        "--surface-hover": ("--accent",),
        "--text-3": ("--muted-foreground",),
        "--hairline": ("--border", "--sidebar-border"),
        "--hairline-strong": ("--input",),
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
    for name, homes in old.items():
        assert migration.rekey({name: "#123456"}) == dict.fromkeys(homes, "#123456"), name


def test_rekey_drops_names_with_no_home(migration: ModuleType) -> None:
    assert migration.rekey({"--text-4": "#666"}) == {}
    # The names the new vocabulary has no word for, all of them.
    assert set(migration.DROPPED) == {
        "--bg-rail",
        "--surface-hover-warm",
        "--surface-hover-deep",
        "--surface-row-hover",
        "--surface-icon",
        "--hairline-soft",
        "--hairline-popover",
        "--text-body",
        "--text-2",
        "--text-4",
        "--text-5",
        "--text-label",
        "--text-faint",
        "--text-rail",
        "--accent-hover",
        "--accent-wash-rail",
        "--accent-wash-soft",
        "--accent-border-soft",
        "--avatar-bg",
        "--disabled-bg",
        "--disabled-fg",
        "--track-off",
        "--scrollbar",
        "--knob",
        "--backdrop",
    }
    assert migration.rekey(dict.fromkeys(migration.DROPPED, "#666")) == {}


def test_rekey_is_idempotent(migration: ModuleType) -> None:
    old = {
        "--bg": "#fbf8f3",
        "--surface": "#fffdf9",
        "--surface-hover": "#f0e9dc",
        "--text": "#1c1a17",
        "--accent": "#7a4f22",
        "--accent-contrast": "#fffdf9",
        "--text-rail": "#5d5347",
    }
    once = migration.rekey(old)
    # `--accent` is on both sides of the rename (the brand colour before, the hover wash
    # after), so a second pass must recognise names it has already written.
    assert once["--accent"] == "#f0e9dc"
    assert migration.rekey(once) == once

    new = {"--background": "#fff", "--primary": "#111", "--accent": "#eee", "--ring": "#999"}
    assert migration.rekey(new) == new


def test_rekey_only_writes_names_a_theme_may_set(migration: ModuleType) -> None:
    every_old_name = dict.fromkeys(migration.OLD_NAMES, "#123456")
    assert set(migration.rekey(every_old_name)) <= set(THEMEABLE_TOKENS)
    assert set(migration.NEW_NAMES) == set(THEMEABLE_TOKENS)


def test_the_old_vocabulary_is_accounted_for(migration: ModuleType) -> None:
    assert len(migration.OLD_NAMES) == len(set(migration.OLD_NAMES)) == 44
    assert set(migration.REKEY) <= set(migration.OLD_NAMES)
    assert set(migration.DROPPED) == set(migration.OLD_NAMES) - set(migration.REKEY)


def test_the_frozen_presets_are_the_ones_shipped(migration: ModuleType) -> None:
    """A snapshot, not a mirror: it is meant to fail the day somebody edits a preset.

    `ensure_presets` never rewrites a preset a workspace already has, so changing one in
    `services/themes.PRESETS` reaches new workspaces only. An edit that should reach the
    rest needs a migration of its own with its own frozen copy, and this test is what
    says so; 0078's copy must keep matching what shipped with it.
    """
    assert migration.PRESET_TOKENS == {preset["slug"]: preset["tokens"] for preset in PRESETS}


# ─── the database ─────────────────────────────────────────────────────────────
async def test_upgrade_rewrites_custom_and_preset_rows(
    client: Client, migration: ModuleType
) -> None:
    owner = await sign_up(client, "Owner")
    await owner.get("/api/bootstrap")  # presets are inserted by the first bootstrap

    old_custom = {
        "--bg": "#0e1210",
        "--surface": "#16201a",
        "--text": "#e6efe9",
        "--accent": "#3fb394",
        "--text-4": "#8aa396",
        "--bg-rail": "#0a100c",
    }
    old_linen = {"--bg": "#fbf8f3", "--accent": "#7a4f22", "--text-rail": "#5d5347"}

    async with SessionFactory() as session, session.begin():
        workspace_id = (await session.execute(text("SELECT id FROM workspaces"))).scalar_one()
        await session.execute(
            text(
                """
                INSERT INTO themes (id, workspace_id, slug, name, mode, tokens, created_by)
                VALUES ('0192e5a0-0000-7000-8000-000000000001', :ws, 'greenhouse',
                        'Greenhouse', 'dark', cast(:tokens AS jsonb), :by)
                """
            ),
            {"ws": workspace_id, "tokens": json.dumps(old_custom), "by": owner.user_id},
        )
        await session.execute(
            text("UPDATE themes SET tokens = cast(:tokens AS jsonb) WHERE slug = 'linen'"),
            {"tokens": json.dumps(old_linen)},
        )

        await (await session.connection()).run_sync(migration.rewrite_themes)

    async with SessionFactory() as session:
        rows = (
            await session.execute(text("SELECT slug, is_preset, tokens FROM themes"))
        ).fetchall()
    tokens = {row.slug: row.tokens for row in rows}

    assert tokens["greenhouse"] == {
        "--background": "#0e1210",
        "--card": "#16201a",
        "--popover": "#16201a",
        "--foreground": "#e6efe9",
        "--card-foreground": "#e6efe9",
        "--popover-foreground": "#e6efe9",
        "--accent-foreground": "#e6efe9",
        "--sidebar-foreground": "#e6efe9",
        "--primary": "#3fb394",
        "--sidebar-primary": "#3fb394",
    }
    assert tokens["linen"] == migration.PRESET_TOKENS["linen"]
    # Every shipped preset, not only the one the test spoiled.
    for row in rows:
        if row.is_preset:
            assert row.tokens == migration.PRESET_TOKENS[row.slug], row.slug
    assert {"paper", "midnight"} <= set(tokens)
    assert tokens["paper"] == {} and tokens["midnight"] == {}


async def test_running_it_twice_changes_nothing(client: Client, migration: ModuleType) -> None:
    """`downgrade` is a no-op, so a downgrade and another upgrade meets rewritten rows."""
    owner = await sign_up(client, "Owner")
    await owner.get("/api/bootstrap")
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO themes (id, workspace_id, slug, name, mode, tokens)
                SELECT '0192e5a0-0000-7000-8000-000000000002', id, 'once', 'Once', 'light',
                       cast(:tokens AS jsonb)
                  FROM workspaces
                """
            ),
            {"tokens": json.dumps({"--surface-hover": "#eeeeee", "--bg": "#ffffff"})},
        )
        connection = await session.connection()
        await connection.run_sync(migration.rewrite_themes)
        first = (await session.execute(text("SELECT slug, tokens FROM themes"))).fetchall()
        await connection.run_sync(migration.rewrite_themes)
        second = (await session.execute(text("SELECT slug, tokens FROM themes"))).fetchall()
    assert {row.slug: row.tokens for row in first} == {row.slug: row.tokens for row in second}
    assert {row.slug: row.tokens for row in second}["once"] == {
        "--accent": "#eeeeee",
        "--background": "#ffffff",
    }
