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

    def test_a_blank_name_falls_back_to_the_default(self) -> None:
        # Unlike the two settings above, this field is `str`, not `str | None`, so a
        # blank value cannot mean "unset" — it falls back to the same default a missing
        # `JANUS_AGENT_NAME` gets, not to "".
        settings = build(JANUS_AGENT_NAME="")
        assert settings.JANUS_AGENT_NAME == "Janus"

    def test_manifest_does_not_raise_when_the_name_is_blank(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The settings-level test above is not the one that would have caught the actual
        # bug: `services/janus_agent.manifest()` passes `JANUS_AGENT_NAME` straight to
        # `Manifest.name`, a `Field(min_length=1, ...)`, and a blank value reaching that
        # field raised a pydantic ValidationError there — not an AppError, so
        # `services/signup.py` re-raised it and the first signup on a misconfigured
        # instance 500'd with no workspace created. This pins that path directly.
        monkeypatch.setattr(janus_agent, "settings", build(JANUS_AGENT_NAME=""))
        manifest = janus_agent.manifest()
        assert manifest.name == "Janus"


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

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT answers_dm_without_mention FROM plugins WHERE id = :id"),
                    {"id": plugin_id},
                )
            ).fetchone()
        # The agent Blob presents as *the* assistant is addressed by its own DM. Only a
        # seeder may set this, so the install call is the only place it can be lost.
        assert row is not None and row.answers_dm_without_mention is True

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
                first = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
                second = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
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
                again = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
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

    async def test_the_secret_is_reconciled_to_the_configured_one(
        self, janus: None, client: Client
    ) -> None:
        """A workspace that already holds a Blob-minted secret has to move to the shared one.

        Blob signs with `plugin_secrets.signing_secret`, not with the setting. Leave a
        stale value there and the container verifies with one secret while Blob signs with
        another: /v1/agui answers 401 and every run fails in a way that looks exactly like
        the agent being down.
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
                    text("UPDATE plugin_secrets SET signing_secret = :old WHERE plugin_id = :id"),
                    {"old": "minted-by-blob-and-never-shown-to-anyone", "id": plugin_id},
                )

        async with SessionFactory() as session:
            bot_before = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()

        async with SessionFactory() as session:
            async with session.begin():
                again = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
        assert again == plugin_id

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT signing_secret FROM plugin_secrets WHERE plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).fetchone()
            bot_after = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()
        assert row is not None and row.signing_secret == "shared-with-the-container"
        # Reconciled in place, like the URL: the bot and its history stay.
        assert bot_before is not None and bot_after is not None
        assert bot_before.id == bot_after.id


class TestItIsInTheRoomsItIsMentionedIn:
    async def test_the_bot_joins_the_public_channels(self, janus: None, client: Client) -> None:
        # A mention in a channel the bot is not in fails the membership check and is
        # dropped silently — no message, no error, no run row. An agent that was seeded
        # and joined nothing is indistinguishable from one that is down.
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)

        channel = (await owner.get("/api/channels")).body["channels"][0]
        member_ids = (await owner.get(f"/api/channels/{channel['id']}/members")).body["userIds"]
        people = (await owner.get("/api/users")).body["users"]
        bot = next(u for u in people if u["displayName"] == settings.JANUS_AGENT_NAME)
        assert bot["id"] in member_ids

    async def test_a_public_channel_founded_later_has_it(self, janus: None, client: Client) -> None:
        # Seeded at signup into the channels that existed then; a channel founded
        # afterwards gets it at founding, through the flag the install set.
        owner = await sign_up(client, "Founder")
        later = (await owner.post("/api/channels", {"name": "later", "kind": "public"})).body[
            "channel"
        ]

        member_ids = (await owner.get(f"/api/channels/{later['id']}/members")).body["userIds"]
        people = (await owner.get("/api/users")).body["users"]
        bot = next(u for u in people if u["displayName"] == settings.JANUS_AGENT_NAME)
        assert bot["id"] in member_ids

    async def test_it_does_not_join_a_private_channel(self, janus: None, client: Client) -> None:
        # A private channel's membership is what makes it private. Adding anyone to it —
        # a bot included — is the members' call, not the server's.
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)
        private = (await owner.post("/api/channels", {"name": "founders", "kind": "private"})).body[
            "channel"
        ]

        async with SessionFactory() as session:
            async with session.begin():
                await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)

        member_ids = (await owner.get(f"/api/channels/{private['id']}/members")).body["userIds"]
        people = (await owner.get("/api/users")).body["users"]
        bot = next(u for u in people if u["displayName"] == settings.JANUS_AGENT_NAME)
        assert bot["id"] not in member_ids


class TestTheSlugAloneIsNotIdentity:
    """A `janus` row is not this seeder's row unless it has this seeder's shape."""

    async def test_a_container_row_is_not_adopted(self, janus: None, client: Client) -> None:
        # `jobs/deployments.py` re-heals every container row's agui_url from the runner at
        # worker startup and every ten minutes after. Adopt one here and the address flaps
        # forever: boot writes the internal URL, the sync writes the public one back.
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
                await session.execute(
                    text(
                        """
                        UPDATE plugins
                           SET runtime = 'container', agui_url = :url, source_repo = :repo
                         WHERE id = :id
                        """
                    ),
                    {
                        "url": "https://janus.example.com/v1/agui",
                        # `plugins_container_needs_repo`: a container row is one the
                        # runner built, and the schema will not let it exist without one.
                        "repo": "https://github.com/someone/janus",
                        "id": plugin_id,
                    },
                )

        async with SessionFactory() as session:
            async with session.begin():
                # Refused, not raised: one workspace's name clash must not stop the boot
                # reconcile for every workspace after it.
                again = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
        assert again is None

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT agui_url FROM plugins WHERE id = :id"), {"id": plugin_id}
                )
            ).fetchone()
        assert row is not None and row.agui_url == "https://janus.example.com/v1/agui"

    async def test_somebodys_own_agent_is_not_adopted(self, janus: None, client: Client) -> None:
        # `routers/my_agents.py` derives the slug from the name, so a member's personal
        # agent called "Janus" holds this slug. Writing an agui_url onto it would be the
        # server reaching into somebody's private agent.
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
                await session.execute(
                    text(
                        "UPDATE plugins SET owner_user_id = :owner, agui_url = :url WHERE id = :id"
                    ),
                    {
                        "owner": owner.user_id,
                        "url": "https://mine.example.com/v1/agui",
                        "id": plugin_id,
                    },
                )

        async with SessionFactory() as session:
            async with session.begin():
                again = await janus_agent.ensure(session, workspace_id, installed_by=owner.user_id)
        assert again is None

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT agui_url FROM plugins WHERE id = :id"), {"id": plugin_id}
                )
            ).fetchone()
        assert row is not None and row.agui_url == "https://mine.example.com/v1/agui"

    async def test_a_taken_slug_does_not_stop_the_boot_reconcile(
        self, janus: None, client: Client
    ) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with SessionFactory() as session:
            async with session.begin():
                plugin_id = await janus_agent.ensure(
                    session, workspace_id, installed_by=owner.user_id
                )
                await session.execute(
                    text(
                        "UPDATE plugins SET runtime = 'container', source_repo = :repo "
                        "WHERE id = :id"
                    ),
                    {"repo": "https://github.com/someone/janus", "id": plugin_id},
                )

        # Nothing raises, and the workspace is reported as having gained nothing rather
        # than counted as seeded.
        assert await janus_agent.ensure_everywhere() == 0


class TestReconcilingAtBoot:
    async def test_a_workspace_that_predates_the_setting_gains_it_at_boot(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Founded before anybody turned Janus on, which is every workspace on the deploy
        that adds it. The settings arrive as environment variables, so the moment they
        change is a restart — and a restart is when this runs.

        Signed up with Janus off on purpose: with it on, `services/workspaces.py` seeds it
        at signup and this would be reconciling something already there.
        """
        owner = await sign_up(client, "Founder")
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert not any(p["slug"] == janus_agent.AGENT_SLUG for p in apps)

        monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
        monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
        assert await janus_agent.ensure_everywhere() >= 1

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert any(p["slug"] == janus_agent.AGENT_SLUG for p in apps)

    async def test_reconciling_twice_seeds_nothing_the_second_time(
        self, janus: None, client: Client
    ) -> None:
        await sign_up(client, "Founder")
        await janus_agent.ensure_everywhere()
        assert await janus_agent.ensure_everywhere() == 0


class TestAWorkspaceFoundedAfterBoot:
    async def test_signing_up_seeds_it(self, janus: None, client: Client) -> None:
        # The boot reconcile cannot reach a workspace that does not exist yet, and on a
        # fresh deployment the first workspace is founded at signup — so without the hook
        # in `services/workspaces.py` it would hold @Blob and no @Janus until a restart.
        owner = await sign_up(client, "Founder")

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert any(p["slug"] == janus_agent.AGENT_SLUG for p in apps)

    async def test_signing_up_seeds_nothing_when_it_is_not_running(self, client: Client) -> None:
        # No `janus` fixture: `conftest.py` leaves the settings off for the rest of the
        # suite, which is the state every deployment that has not opted in is in.
        owner = await sign_up(client, "Founder")

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert not any(p["slug"] == janus_agent.AGENT_SLUG for p in apps)


class TestTheUrlIsNotExemptFromTheGuardItSkips:
    async def test_https_is_required_for_registered_urls(self, client: Client) -> None:
        # `registry.install` has never looked at a URL, so `ensure` calling it directly
        # is outside `_assert_reachable` by construction, not by an exemption anybody
        # passes. This test verifies the https-required check still fires when a URL is
        # typed into the admin console, even if it points to an internal address.
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

    async def test_private_hosts_are_refused_even_with_https(self, client: Client) -> None:
        # Once a URL passes the https check, it reaches the private-address guard.
        # This test verifies that guard still refuses internal hostnames like janus,
        # even when the URL uses https as required.
        owner = await sign_up(client, "Founder")

        response = await owner.post(
            "/api/admin/plugins",
            {
                "slug": "janus-https",
                "name": "Janus HTTPS",
                "runtime": "external",
                "aguiUrl": "https://janus:8642/v1/agui",
                "scopes": list(janus_agent.AGENT_SCOPES),
            },
        )

        assert response.status == 403, response.body
        assert response.body["error"]["code"] == "policy_forbidden"
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert not any(p["slug"] == "janus-https" for p in apps)
