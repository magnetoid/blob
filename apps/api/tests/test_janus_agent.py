"""Janus as a service inside Blob's own stack.

Seeded rather than registered, for the reason `services/workspace_agent.py` gives about
the built-in agent: a setup task somebody may never do is not a feature. The difference
is that this one is somebody else's code, so it is installed untrusted and holds granted
scopes like any app.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from blob_api.config import Settings, settings
from blob_api.db.engine import SessionFactory
from blob_api.services import janus_agent

from .helpers import Client, sign_up, workspace_id_of

REQUIRED = {
    "DATABASE_URL": "postgres://blob:blob@localhost:5432/blob_test",
    "SESSION_SECRET": "test-secret-that-is-at-least-32-characters-long",
}


def build(**overrides: str) -> Settings:
    """A `Settings` built from these values alone, the way test_llm_config does."""
    return Settings(_env_file=None, **{**REQUIRED, **overrides})  # type: ignore[arg-type]


class TestSettings:
    def test_janus_is_off_by_default(self) -> None:
        assert build().JANUS_AGUI_URL is None
        assert build().JANUS_SIGNING_SECRET is None

    def test_the_default_name_is_janus(self) -> None:
        assert build().JANUS_AGENT_NAME == "Janus"

    def test_a_blank_value_reads_as_unset(self) -> None:
        # `.env.example` ships these with nothing after the equals. Without the
        # validator they arrive as "", which is falsy but is not None — and
        # `configured()` asks `is None`.
        settings = build(JANUS_AGUI_URL="", JANUS_SIGNING_SECRET="")
        assert settings.JANUS_AGUI_URL is None
        assert settings.JANUS_SIGNING_SECRET is None


@pytest.fixture
def janus(monkeypatch: pytest.MonkeyPatch) -> None:
    """The live singleton, patched the way `test_builtin_agent.py`'s `model` fixture
    patches the LLM settings — `conftest.py` forces `settings` off for the rest of the
    suite, so a test that wants Janus running has to turn it on the same way."""
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
    monkeypatch.setattr(settings, "JANUS_AGENT_NAME", "Janus")


class TestSeeding:
    async def test_nothing_is_seeded_when_it_is_not_running(self, client: Client) -> None:
        # Both halves are required: a URL with no secret cannot authenticate a run, and a
        # secret with no URL has nothing to call.
        assert janus_agent.configured() is False

    async def test_it_is_installed_with_the_manifest_scopes(
        self, janus: None, client: Client
    ) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
        assert plugin_id is not None

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in apps if p["slug"] == "janus")
        assert agent["runtime"] == "external"
        assert sorted(agent["scopes"]) == [
            "channels:join",
            "channels:read",
            "messages:read",
            "messages:write",
        ]

    async def test_the_secret_is_the_configured_one(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT signing_secret FROM plugin_secrets WHERE plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).fetchone()
        assert row is not None
        assert row.signing_secret == "shared-with-the-container"

    async def test_seeding_twice_installs_once(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                first = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
                second = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
        assert first == second

    async def test_an_existing_janus_moves_to_the_internal_url(
        self, janus: None, client: Client
    ) -> None:
        """Production already has a `janus` row pointing at a public domain.

        Updated in place rather than reinstalled: `uninstall` retires the bot — it sets
        `deactivated_at`, releases the handle and mangles the address — so a
        remove-and-reinstall would take the agent's history, its channel memberships and
        its place in the sidebar with it.
        """
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
                assert plugin_id is not None
                await session.execute(
                    text("UPDATE plugins SET agui_url = :old WHERE id = :id"),
                    {"old": "https://janus.example.com/v1/agui", "id": plugin_id},
                )

        async with SessionFactory() as session:
            bot_before = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()

        async with SessionFactory() as session:
            async with session.begin():
                again = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
        assert again == plugin_id

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT agui_url FROM plugins WHERE id = :id"), {"id": plugin_id}
                )
            ).fetchone()
            bot_after = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()
        assert row is not None and row.agui_url == "http://janus:8642/v1/agui"
        assert bot_before is not None and bot_after is not None
        assert bot_before.id == bot_after.id


class TestReconcilingAtBoot:
    async def test_every_workspace_gains_it_at_boot(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        seeded = await janus_agent.ensure_everywhere()
        assert seeded >= 1

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert any(p["slug"] == "janus" for p in apps)

    async def test_reconciling_twice_seeds_nothing_the_second_time(
        self, janus: None, client: Client
    ) -> None:
        await sign_up(client, "Founder")
        await janus_agent.ensure_everywhere()
        assert await janus_agent.ensure_everywhere() == 0


class TestTheUrlIsNotExemptFromTheGuardItSkips:
    async def test_the_same_url_typed_by_hand_is_still_refused(self, client: Client) -> None:
        # `registry.install` has never looked at a URL, so `ensure` calling it directly
        # is outside `_assert_reachable` by construction, not by an exemption anybody
        # passes. This is the other half of that claim: a person typing Janus's own
        # internal URL into the console goes through the route the guard sits on, and
        # is refused there exactly as any other private address would be.
        owner = await sign_up(client, "Founder")

        response = await owner.post(
            "/api/admin/plugins",
            {
                "slug": "janus-by-hand",
                "name": "Janus",
                "runtime": "external",
                "aguiUrl": "http://janus:8642/v1/agui",
                "scopes": list(janus_agent.AGENT_SCOPES),
            },
        )

        assert response.status == 400, response.body
        assert response.body["error"]["code"] == "bad_request_url"
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert not any(p["slug"] == "janus-by-hand" for p in apps)
