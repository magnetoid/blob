"""Themes.

The security-relevant property is that a theme is *data*: token names come from an
allowlist and values must look like colours, so a theme can never smuggle a CSS
declaration into the page.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from blob_api.lib.errors import AppError
from blob_api.services.themes import PRESETS, THEMEABLE_TOKENS, validate_tokens

from .helpers import Client, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    # Presets are inserted lazily, on the first bootstrap that needs them.
    await owner.get("/api/bootstrap")
    return {"owner": owner, "member": member}


# ─── validation ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "value", ["#fff", "#1f5c3d", "#1f5c3dcc", "rgb(31 92 61)", "rgba(31, 92, 61, 0.5)"]
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
        "",
    ],
)
def test_rejects_anything_that_is_not_plainly_a_colour(value: str) -> None:
    with pytest.raises(AppError) as excinfo:
        validate_tokens({"--accent": value})
    assert excinfo.value.status_code == 400


def test_rejects_tokens_outside_the_allowlist() -> None:
    # A typo should surface at save time rather than silently doing nothing.
    with pytest.raises(AppError):
        validate_tokens({"--acccent": "#fff"})
    # And nothing structural is themeable — only colour.
    with pytest.raises(AppError):
        validate_tokens({"--sidebar-width": "900px"})


def test_every_preset_only_uses_themeable_tokens() -> None:
    for preset in PRESETS:
        unknown = set(preset["tokens"]) - set(THEMEABLE_TOKENS)
        assert not unknown, f"{preset['slug']} sets unknown tokens: {unknown}"
        validate_tokens(preset["tokens"])


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
        {"name": "Forest", "mode": "dark", "tokens": {"--accent": "#3fb394"}},
    )
    assert created.status == 200
    theme = created.body["theme"]
    assert theme["slug"] == "forest"
    assert theme["isPreset"] is False

    edited = await team["owner"].put(
        "/api/admin/themes",
        {
            "id": theme["id"],
            "name": "Forest",
            "mode": "dark",
            "tokens": {"--accent": "#55c7a8", "--bg": "#0e1210"},
        },
    )
    assert edited.body["theme"]["tokens"] == {"--accent": "#55c7a8", "--bg": "#0e1210"}

    assert (await team["owner"].delete(f"/api/admin/themes/{theme['id']}")).status == 200
    remaining = (await team["owner"].get("/api/themes")).body["themes"]
    assert all(t["id"] != theme["id"] for t in remaining)


async def test_presets_cannot_be_edited_or_deleted(team: dict) -> None:
    themes = (await team["owner"].get("/api/themes")).body["themes"]
    paper = next(t for t in themes if t["slug"] == "paper")

    edit = await team["owner"].put(
        "/api/admin/themes",
        {"id": paper["id"], "name": "Paper", "mode": "light", "tokens": {"--bg": "#fff"}},
    )
    assert edit.status == 403

    assert (await team["owner"].delete(f"/api/admin/themes/{paper['id']}")).status == 404


async def test_a_theme_with_an_injected_value_is_refused(team: dict) -> None:
    response = await team["owner"].put(
        "/api/admin/themes",
        {"name": "Bad", "mode": "light", "tokens": {"--bg": "#fff; position: fixed"}},
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
