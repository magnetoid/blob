"""Themes.

The security-relevant property is that a theme is *data*: token names come from an
allowlist and values must look like colours, so a theme can never smuggle a CSS
declaration into the page.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import pytest
import pytest_asyncio

from blob_api.lib.errors import AppError
from blob_api.services.themes import PRESETS, THEMEABLE_TOKENS, TOKEN_GROUPS, validate_tokens

from .helpers import Client, invite_and_sign_up, sign_up

THEME_CSS = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "styles" / "theme.css"

#: shadcn preset b0 as the client declares it (`apps/web/src/styles/theme.css`), as the
#: hex a browser draws, for every colour the readability test reads. Taken from
#: `toHex()` in `apps/web/src/lib/color.ts`, which is what the theme editor uses — so
#: this is the same arithmetic, not a second opinion. A preset names only what it
#: changes, and a name it leaves out falls back to these. Light `--muted-foreground` is
#: `oklch(0.54 0 0)`, not b0's 0.556 (see the note at the top of theme.css). b0's dark
#: borders are translucent white, which is a line and not text, and nothing here reads
#: them.
B0_LIGHT_HEX = {
    "--background": "#ffffff",
    "--foreground": "#0a0a0a",
    "--card": "#ffffff",
    "--card-foreground": "#0a0a0a",
    "--popover": "#ffffff",
    "--popover-foreground": "#0a0a0a",
    "--primary": "#171717",
    "--primary-foreground": "#fafafa",
    "--secondary": "#f5f5f5",
    "--secondary-foreground": "#171717",
    "--muted": "#f5f5f5",
    "--muted-foreground": "#6f6f6f",
    "--accent": "#f5f5f5",
    "--accent-foreground": "#171717",
    "--destructive": "#e7000b",
    "--sidebar": "#fafafa",
    "--sidebar-foreground": "#0a0a0a",
    "--sidebar-accent": "#f5f5f5",
    "--sidebar-accent-foreground": "#171717",
}
B0_DARK_HEX = {
    "--background": "#0a0a0a",
    "--foreground": "#fafafa",
    "--card": "#171717",
    "--card-foreground": "#fafafa",
    "--popover": "#171717",
    "--popover-foreground": "#fafafa",
    "--primary": "#e5e5e5",
    "--primary-foreground": "#171717",
    "--secondary": "#262626",
    "--secondary-foreground": "#fafafa",
    "--muted": "#262626",
    "--muted-foreground": "#a1a1a1",
    "--accent": "#262626",
    "--accent-foreground": "#fafafa",
    "--destructive": "#ff6467",
    "--sidebar": "#171717",
    "--sidebar-foreground": "#fafafa",
    "--sidebar-accent": "#262626",
    "--sidebar-accent-foreground": "#fafafa",
}

#: What has to be readable, as (text, what it sits on). WCAG AA for body text: 4.5.
READABLE_PAIRS = [
    ("--foreground", "--background"),
    ("--card-foreground", "--card"),
    ("--popover-foreground", "--popover"),
    ("--primary-foreground", "--primary"),
    ("--secondary-foreground", "--secondary"),
    ("--accent-foreground", "--accent"),
    ("--muted-foreground", "--background"),
    ("--muted-foreground", "--muted"),
    ("--muted-foreground", "--card"),
    ("--muted-foreground", "--sidebar"),
    ("--sidebar-foreground", "--sidebar"),
    ("--sidebar-accent-foreground", "--sidebar-accent"),
    ("--destructive", "--background"),
]


def _luminance(colour: str) -> float:
    digits = colour.lstrip("#")
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    assert len(digits) == 6, f"{colour} is not an opaque hex colour"

    def channel(pair: str) -> float:
        value = int(pair, 16) / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(digits[i : i + 2]) for i in (0, 2, 4))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast(text: str, ground: str) -> float:
    lighter, darker = sorted((_luminance(text), _luminance(ground)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    # Presets are inserted lazily, on the first bootstrap that needs them.
    await owner.get("/api/bootstrap")
    return {"owner": owner, "member": member}


# ─── validation ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "value",
    [
        "#fff",
        "#1f5c3d",
        "#1f5c3dcc",
        "rgb(31 92 61)",
        "rgba(31, 92, 61, 0.5)",
        "oklch(0.54 0 0)",
        "oklch(62.8% 0.25 29.2 / 50%)",
        "oklch(1 0 0 / 10%)",
        "oklch(0.5 0.1 120deg)",
    ],
)
def test_accepts_colours(value: str) -> None:
    assert validate_tokens({"--accent": value}) == {"--accent": value}


@pytest.mark.parametrize(
    "value",
    [
        "red; position: fixed",  # the injection attempt this guard exists for
        "url(https://example.com/x.png)",
        "var(--something-else)",
        "expression(alert(1))",
        "oklch(var(--x))",
        "oklch(1 0 0); color: red",
        "oklch(calc(1) 0 0)",
        "oklch(1 0)",
        "",
    ],
)
def test_rejects_anything_that_is_not_plainly_a_colour(value: str) -> None:
    with pytest.raises(AppError) as excinfo:
        validate_tokens({"--accent": value})
    assert excinfo.value.status_code == 400


def test_a_long_run_of_digits_is_refused_quickly() -> None:
    # `\d*\.?\d+` for a number matches the same strings and takes quadratic time to fail
    # on this one: 20 000 digits kept a worker busy for eight seconds.
    started = time.perf_counter()
    for value in ("oklch(" + "1" * 50_000 + "x", "oklch(1 1 " + "1" * 50_000 + "x"):
        with pytest.raises(AppError):
            validate_tokens({"--accent": value})
    assert time.perf_counter() - started < 1


def test_rejects_tokens_outside_the_allowlist() -> None:
    # A typo should surface at save time rather than silently doing nothing.
    with pytest.raises(AppError):
        validate_tokens({"--acccent": "#fff"})
    # And nothing structural is themeable — only colour.
    with pytest.raises(AppError):
        validate_tokens({"--sidebar-width": "900px"})
    # A name from before the themes moved to shadcn's is refused like any other typo.
    with pytest.raises(AppError):
        validate_tokens({"--bg": "#fff"})


def test_every_preset_only_uses_themeable_tokens() -> None:
    for preset in PRESETS:
        unknown = set(preset["tokens"]) - set(THEMEABLE_TOKENS)
        assert not unknown, f"{preset['slug']} sets unknown tokens: {unknown}"
        validate_tokens(preset["tokens"])


def test_groups_cover_the_allowlist_once() -> None:
    assert list(TOKEN_GROUPS) == ["Surfaces", "Text", "Brand", "Lines", "State", "Charts"]
    listed = [token for group in TOKEN_GROUPS.values() for token in group]
    assert len(listed) == len(set(listed)), "a token sits in two groups"
    assert tuple(listed) == THEMEABLE_TOKENS
    assert TOKEN_GROUPS["Charts"] == tuple(f"--chart-{n}" for n in range(1, 6))


def test_every_colour_the_client_declares_is_themeable() -> None:
    """The client's shadcn variables are the allowlist's source; a new one must be added here.

    `--radius` is the one variable of theirs that is not a colour. The presence and unread
    colours are Blob's own and live in tokens.css, so the check runs one way: everything
    shadcn's palette declares has to be something a theme may set.
    """
    assert THEME_CSS.is_file(), f"{THEME_CSS} has moved; this test needs the new path"
    root = re.search(r"\n:root \{(.*?)\n\}", THEME_CSS.read_text(encoding="utf-8"), re.S)
    assert root is not None
    declared = set(re.findall(r"(--[a-z0-9-]+):", root.group(1))) - {"--radius"}
    assert declared, "found no variables in theme.css"
    assert declared <= set(THEMEABLE_TOKENS), declared - set(THEMEABLE_TOKENS)


@pytest.mark.parametrize("preset", PRESETS, ids=lambda preset: preset["slug"])
def test_every_preset_is_readable(preset: dict) -> None:
    # A name a preset does not set falls back to b0 for its side, as it does on screen.
    palette = {**(B0_LIGHT_HEX if preset["mode"] == "light" else B0_DARK_HEX), **preset["tokens"]}
    low = {
        f"{text} on {ground}": round(_contrast(palette[text], palette[ground]), 2)
        for text, ground in READABLE_PAIRS
        if _contrast(palette[text], palette[ground]) < 4.5
    }
    assert not low, f"{preset['slug']} is under 4.5:1 for {low}"


# ─── the API ──────────────────────────────────────────────────────────────────
async def test_presets_are_available_to_everyone(team: dict) -> None:
    response = await team["member"].get("/api/themes")
    assert response.status == 200
    slugs = {t["slug"] for t in response.body["themes"]}
    assert {"paper", "midnight", "high-contrast", "slate"} <= slugs
    assert all(t["isPreset"] for t in response.body["themes"])


async def test_themes_ride_along_on_bootstrap(team: dict) -> None:
    boot = await team["member"].get("/api/bootstrap")
    assert len(boot.body["themes"]) >= 4
    assert boot.body["user"]["prefs"]["themeLight"] == "paper"
    assert boot.body["user"]["prefs"]["themeDark"] == "midnight"


async def test_a_member_cannot_save_a_theme(team: dict) -> None:
    response = await team["member"].put(
        "/api/admin/themes", {"name": "Mine", "mode": "light", "tokens": {}}
    )
    assert response.status == 403


async def test_an_admin_creates_edits_and_deletes_a_theme(team: dict) -> None:
    created = await team["owner"].put(
        "/api/admin/themes",
        # A name no shipped preset uses, and deliberately not a plausible one: this
        # test is about create/edit/delete, and naming it something the product might
        # one day ship as a palette makes it fail the day somebody adds that palette.
        # It did — "Forest" became a preset and this test started answering 409.
        {"name": "Testbed", "mode": "dark", "tokens": {"--accent": "#3fb394"}},
    )
    assert created.status == 200
    theme = created.body["theme"]
    assert theme["slug"] == "testbed"
    assert theme["isPreset"] is False

    edited = await team["owner"].put(
        "/api/admin/themes",
        {
            "id": theme["id"],
            "name": "Testbed",
            "mode": "dark",
            "tokens": {"--accent": "#55c7a8", "--background": "#0e1210"},
        },
    )
    assert edited.body["theme"]["tokens"] == {
        "--accent": "#55c7a8",
        "--background": "#0e1210",
    }

    assert (await team["owner"].delete(f"/api/admin/themes/{theme['id']}")).status == 200
    remaining = (await team["owner"].get("/api/themes")).body["themes"]
    assert all(t["id"] != theme["id"] for t in remaining)


async def test_presets_cannot_be_edited_or_deleted(team: dict) -> None:
    themes = (await team["owner"].get("/api/themes")).body["themes"]
    paper = next(t for t in themes if t["slug"] == "paper")

    edit = await team["owner"].put(
        "/api/admin/themes",
        {"id": paper["id"], "name": "Paper", "mode": "light", "tokens": {"--background": "#fff"}},
    )
    assert edit.status == 403

    assert (await team["owner"].delete(f"/api/admin/themes/{paper['id']}")).status == 404


async def test_a_theme_with_an_injected_value_is_refused(team: dict) -> None:
    response = await team["owner"].put(
        "/api/admin/themes",
        {"name": "Bad", "mode": "light", "tokens": {"--background": "#fff; position: fixed"}},
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "invalid_token"


async def test_choosing_a_palette_is_a_user_preference(team: dict) -> None:
    response = await team["member"].patch(
        "/api/me/prefs", {"themeLight": "high-contrast", "themeDark": "slate"}
    )
    assert response.body["prefs"]["themeLight"] == "high-contrast"
    assert response.body["prefs"]["themeDark"] == "slate"
    # The other person's choice is untouched.
    owner_prefs = (await team["owner"].get("/api/bootstrap")).body["user"]["prefs"]
    assert owner_prefs["themeLight"] == "paper"


async def test_saving_a_theme_is_audited(team: dict) -> None:
    await team["owner"].put("/api/admin/themes", {"name": "Audited", "mode": "light", "tokens": {}})
    events = (await team["owner"].get("/api/admin/audit?action=theme.saved")).body["events"]
    assert events and events[0]["metadata"]["name"] == "Audited"
