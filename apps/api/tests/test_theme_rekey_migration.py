"""Migration 0078 moves every stored theme onto shadcn's colour names.

A theme's tokens are keyed by name and the client reads them by name, so a row written
under the old vocabulary would set nothing at all after the client moved. The migration
renames what has a home, drops what has none, and rewrites the shipped presets to the
values this release ships — and the rename has to be safe to meet twice, because
`--accent` is a name in both vocabularies. `downgrade` is its best-effort inverse: the old
client reads `--accent` as the brand colour, so rows left on the new names would paint
every hover wash in it.
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
    assert migration.rekey({"--text-2": "#666"}) == {}
    # The names the new vocabulary has no word for, all of them.
    assert set(migration.DROPPED) == {
        "--text-2",
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


# Each of these homes was filled by one main name and, failing that, by the first of its
# fallbacks the theme set. A theme with only a fallback used to lose the colour entirely.
FALLBACK_CASES = {
    "--text": (["--text-body"], ["--foreground", "--card-foreground", "--popover-foreground"]),
    "--text-3": (
        ["--text-4", "--text-5", "--text-label", "--text-faint"],
        ["--muted-foreground"],
    ),
    "--bg-sidebar": (["--bg-rail"], ["--sidebar"]),
    "--hairline": (["--hairline-soft", "--hairline-popover"], ["--border", "--sidebar-border"]),
    "--surface-hover": (
        ["--surface-row-hover", "--surface-hover-warm", "--surface-hover-deep"],
        ["--accent"],
    ),
    "--surface-muted": (["--surface-icon"], ["--muted"]),
}


@pytest.mark.parametrize("main", FALLBACK_CASES)
def test_rekey_falls_back_to_the_next_name_that_had_the_same_home(
    migration: ModuleType, main: str
) -> None:
    chain, homes = FALLBACK_CASES[main]
    assert tuple(chain) == migration.FALLBACKS[main], "the chain is the one the brief names"
    for index, name in enumerate(chain):
        # Alone, a fallback fills every home its main name would have.
        alone = migration.rekey({name: "#aaaaaa"})
        for home in homes:
            assert alone[home] == "#aaaaaa", f"{name} -> {home}"
        # With the names above it, it is not read: the first present wins.
        above = {earlier: f"#00000{i}" for i, earlier in enumerate(chain[:index], start=1)}
        got = migration.rekey({**above, name: "#aaaaaa"})
        if above:
            for home in homes:
                assert got[home] == "#000001", f"{name} must lose to {chain[0]} on {home}"
    # The main name beats the whole chain.
    everything = {name: f"#1{i}1{i}1{i}" for i, name in enumerate(chain)}
    got = migration.rekey({**everything, main: "#abcdef"})
    for home in homes:
        assert got[home] == "#abcdef", f"{main} -> {home}"


def test_rekey_with_the_main_names_present_ignores_every_fallback(migration: ModuleType) -> None:
    mains = dict.fromkeys(migration.FALLBACKS, "#111111")
    fallbacks = {name: "#999999" for chain in migration.FALLBACKS.values() for name in chain}
    assert migration.rekey({**mains, **fallbacks}) == migration.rekey(mains)


def test_a_cloned_preset_keeps_its_greys(migration: ModuleType) -> None:
    """A theme copied from Linen carries the old preset's fallback names beside the main ones."""
    cloned = dict(migration.OLD_PRESET_TOKENS["linen"])
    assert {"--surface-row-hover", "--hairline-soft"} <= set(cloned)
    got = migration.rekey(cloned)
    assert got["--accent"] == cloned["--surface-hover"]
    assert got["--border"] == cloned["--hairline"]
    assert got["--sidebar"] == cloned["--bg-sidebar"]


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
    in_chains = {name for chain in migration.FALLBACKS.values() for name in chain}
    assert set(migration.FALLBACKS) <= set(migration.REKEY)
    assert in_chains <= set(migration.OLD_NAMES) - set(migration.REKEY)
    assert set(migration.DROPPED) == set(migration.OLD_NAMES) - set(migration.REKEY) - in_chains


def test_the_frozen_presets_are_the_ones_shipped(migration: ModuleType) -> None:
    """A snapshot, not a mirror: it is meant to fail the day somebody edits a preset.

    `ensure_presets` never rewrites a preset a workspace already has, so changing one in
    `services/themes.PRESETS` reaches new workspaces only. An edit that should reach the
    rest needs a migration of its own with its own frozen copy, and this test is what
    says so; 0078's copy must keep matching what shipped with it.
    """
    assert migration.PRESET_TOKENS == {preset["slug"]: preset["tokens"] for preset in PRESETS}


# ─── the way back ─────────────────────────────────────────────────────────────
def test_unkey_puts_every_restorable_name_back(migration: ModuleType) -> None:
    for new, old in migration.RESTORE.items():
        assert migration.unkey({new: "#123456"}) == {old: "#123456"}, new
    # The two names that are in both vocabularies mean different things on each side.
    assert migration.unkey({"--accent": "#eeeeee", "--primary": "#7a4f22"}) == {
        "--surface-hover": "#eeeeee",
        "--accent": "#7a4f22",
    }


def test_restore_is_the_inverse_of_rekey_from_each_names_first_home(migration: ModuleType) -> None:
    assert set(migration.RESTORE) <= set(migration.NEW_NAMES)
    assert set(migration.RESTORE.values()) <= set(migration.OLD_NAMES)
    # Two new names writing one old one would make the result depend on dict order.
    assert len(set(migration.RESTORE.values())) == len(migration.RESTORE)
    # Every old name that has a home goes back to where it came from.
    # A name with two homes goes back from the first, which speaks for the rest.
    for old, homes in migration.REKEY.items():
        assert migration.RESTORE[homes[0]] == old, old


def test_unkey_drops_what_the_old_vocabulary_has_no_name_for(migration: ModuleType) -> None:
    second_homes_and_new_words = (
        "--popover",
        "--card-foreground",
        "--popover-foreground",
        "--accent-foreground",
        "--sidebar-foreground",
        "--secondary",
        "--secondary-foreground",
        "--sidebar-primary",
        "--sidebar-primary-foreground",
        "--sidebar-accent-foreground",
        "--sidebar-border",
        "--sidebar-ring",
        "--chart-1",
        "--chart-5",
    )
    assert migration.unkey(dict.fromkeys(second_homes_and_new_words, "#123456")) == {}


def test_unkey_leaves_an_old_theme_alone(migration: ModuleType) -> None:
    """Met twice, `--accent` (already the brand colour) must not become `--surface-hover`."""
    old = {"--bg": "#fff", "--accent": "#7a4f22", "--surface-hover": "#eee"}
    assert migration.unkey(old) == old
    assert migration.unkey({"--bg": "#fff", "--card": "#fff"}) == {"--bg": "#fff"}


def test_unkey_after_rekey_keeps_what_both_vocabularies_share(migration: ModuleType) -> None:
    old = {
        "--bg": "#fbf8f3",
        "--surface": "#fffdf9",
        "--surface-muted": "#f6f1e8",
        "--surface-hover": "#f0e9dc",
        "--hairline": "#e6ddcd",
        "--hairline-strong": "#999999",
        "--text": "#1c1a17",
        "--text-3": "#6b6b6b",
        "--accent": "#7a4f22",
        "--accent-contrast": "#fffdf9",
        "--accent-border": "#7a4f22",
        "--bg-sidebar": "#f4eee3",
        "--accent-wash": "#f3ebe0",
        "--danger": "#8a1c12",
        "--presence-online": "#2f7d4f",
        "--unread-text": "#a0663a",
    }
    assert migration.unkey(migration.rekey(old)) == old
    # And what has no way back is the loss, not a surprise: dropped on the way down.
    lossy = {"--text-2": "#777777", "--text-rail": "#ece4d6", "--bg": "#fff"}
    assert migration.unkey(migration.rekey(lossy)) == {"--bg": "#fff"}


def test_the_old_presets_are_the_twelve_that_shipped_before(migration: ModuleType) -> None:
    assert set(migration.OLD_PRESET_TOKENS) == set(migration.PRESET_TOKENS)
    assert migration.OLD_PRESET_TOKENS["paper"] == {}
    assert migration.OLD_PRESET_TOKENS["midnight"] == {}
    for slug, tokens in migration.OLD_PRESET_TOKENS.items():
        assert set(tokens) <= set(migration.OLD_NAMES), slug
        assert all(isinstance(value, str) and value.startswith("#") for value in tokens.values())
        # Not the new presets under the old names: none of them speaks the new vocabulary.
        assert not set(tokens) & set(migration.NEW_NAMES) - {"--accent"}, slug
    # One spot-check of a value that only the old copy carries.
    assert migration.OLD_PRESET_TOKENS["linen"]["--accent"] == "#7a4f22"
    assert migration.OLD_PRESET_TOKENS["linen"]["--bg-rail"] == "#ece4d6"


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
        # Set under a name that shares its home with a main one the theme did not set.
        "--muted-foreground": "#8aa396",
        "--sidebar": "#0a100c",
    }
    assert tokens["linen"] == migration.PRESET_TOKENS["linen"]
    # Every shipped preset, not only the one the test spoiled.
    for row in rows:
        if row.is_preset:
            assert row.tokens == migration.PRESET_TOKENS[row.slug], row.slug
    assert {"paper", "midnight"} <= set(tokens)
    assert tokens["paper"] == {} and tokens["midnight"] == {}


async def test_running_it_twice_changes_nothing(client: Client, migration: ModuleType) -> None:
    """Nothing stops a deploy being run twice, and the second pass meets rewritten rows."""
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


async def test_a_downgrade_gives_the_old_presets_back_and_a_second_upgrade_agrees(
    client: Client, migration: ModuleType
) -> None:
    """Old rows -> upgrade -> downgrade: presets exactly, custom themes on the old names."""
    owner = await sign_up(client, "Owner")
    await owner.get("/api/bootstrap")  # presets are inserted by the first bootstrap

    old_custom = {
        "--bg": "#0e1210",
        "--surface": "#16201a",
        "--surface-hover": "#1f2c24",
        "--text": "#e6efe9",
        "--accent": "#3fb394",
        "--accent-contrast": "#06130f",
        "--danger": "#ff6b6b",
        "--text-4": "#8aa396",
        "--bg-rail": "#0a100c",
        "--text-rail": "#5d5347",
    }
    # Saved by the new client after the upgrade: nothing in it is an old-only name.
    new_custom = {
        "--background": "#101010",
        "--accent": "#222222",
        "--primary": "#88aaff",
        "--secondary": "#303030",
        "--chart-1": "#ff00ff",
    }

    async with SessionFactory() as session, session.begin():
        workspace_id = (await session.execute(text("SELECT id FROM workspaces"))).scalar_one()
        for index, (slug, tokens) in enumerate(
            (("greenhouse", old_custom), ("newcomer", new_custom)), start=3
        ):
            await session.execute(
                text(
                    """
                    INSERT INTO themes (id, workspace_id, slug, name, mode, tokens, created_by)
                    VALUES (cast(:id AS uuid), :ws, :slug, :slug, 'dark',
                            cast(:tokens AS jsonb), :by)
                    """
                ),
                {
                    "id": f"0192e5a0-0000-7000-8000-00000000000{index}",
                    "ws": workspace_id,
                    "slug": slug,
                    "tokens": json.dumps(tokens),
                    "by": owner.user_id,
                },
            )
        # Every preset as the previous release left it.
        for slug, tokens in migration.OLD_PRESET_TOKENS.items():
            await session.execute(
                text(
                    "UPDATE themes SET tokens = cast(:tokens AS jsonb)"
                    " WHERE slug = :slug AND is_preset"
                ),
                {"slug": slug, "tokens": json.dumps(tokens)},
            )

        connection = await session.connection()

        async def stored() -> dict[str, dict[str, str]]:
            rows = (await session.execute(text("SELECT slug, tokens FROM themes"))).fetchall()
            return {row.slug: row.tokens for row in rows}

        await connection.run_sync(migration.rewrite_themes)
        upgraded = await stored()
        # The new-format theme is not rekeyed again: `--accent` stays a hover wash.
        assert upgraded["newcomer"] == new_custom
        assert upgraded["linen"] == migration.PRESET_TOKENS["linen"]
        assert upgraded["greenhouse"]["--primary"] == "#3fb394"

        await connection.run_sync(migration.restore_themes)
        downgraded = await stored()

        await connection.run_sync(migration.restore_themes)
        assert await stored() == downgraded, "a second downgrade changes nothing"

        await connection.run_sync(migration.rewrite_themes)
        again = await stored()

    # Upgrading again lands where the first upgrade did — for every row that lost nothing
    # on the way down. The new-format theme set two colours the old vocabulary has no name
    # for (`--secondary`, `--chart-1`), and those are the price of having gone back.
    assert {slug: tokens for slug, tokens in again.items() if slug != "newcomer"} == {
        slug: tokens for slug, tokens in upgraded.items() if slug != "newcomer"
    }
    assert again["newcomer"] == {
        "--background": "#101010",
        "--accent": "#222222",
        "--primary": "#88aaff",
        "--sidebar-primary": "#88aaff",
    }

    # Presets are exactly what they were; Paper and Midnight are still empty.
    for slug, tokens in migration.OLD_PRESET_TOKENS.items():
        assert downgraded[slug] == tokens, slug
    # A custom theme is back on the old names, with only what had a name to go back to:
    # `--text-4` and `--bg-rail` came back as the names that stood in for them (`--text-3`,
    # `--bg-sidebar`), `--text-rail` had no home at all.
    assert downgraded["greenhouse"] == {
        "--bg": "#0e1210",
        "--surface": "#16201a",
        "--surface-hover": "#1f2c24",
        "--text": "#e6efe9",
        "--text-3": "#8aa396",
        "--bg-sidebar": "#0a100c",
        "--accent": "#3fb394",
        "--accent-contrast": "#06130f",
        "--danger": "#ff6b6b",
    }
    assert downgraded["newcomer"] == {
        "--bg": "#101010",
        "--surface-hover": "#222222",
        "--accent": "#88aaff",
    }
    # No row is left on a name the old client would misread: every key is an old name,
    # and `--accent` appears only where the brand colour was meant.
    for slug, tokens in downgraded.items():
        assert set(tokens) <= set(migration.OLD_NAMES), slug
