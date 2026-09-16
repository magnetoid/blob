"""Janus as a service inside Blob's own stack.

Seeded rather than registered by hand, because a setup task somebody may never do is not
a feature — and it is nonetheless somebody else's code, so it goes in through the ordinary
install path with no exemption and holds granted scopes like any app.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from blob_api.config import Settings, settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.services import janus_agent

from .helpers import Client, allow_policy, send_message, sign_up, workspace_id_of

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
    """The live singleton, turned on for the tests that need it. `conftest.py` forces
    `settings` off for the whole suite, so a test that wants Janus running asks for this."""
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

    @staticmethod
    async def _bot_id(owner: Client) -> str:
        people = (await owner.get("/api/users")).body["users"]
        return str(next(u for u in people if u["displayName"] == settings.JANUS_AGENT_NAME)["id"])

    @staticmethod
    async def _found_public(owner: Client, name: str) -> str:
        made = await owner.post("/api/channels", {"name": name, "kind": "public"})
        assert made.status == 200, made.body
        return str(made.body["channel"]["id"])

    @staticmethod
    async def _members_of(owner: Client, channel_id: str) -> list[str]:
        return list((await owner.get(f"/api/channels/{channel_id}/members")).body["userIds"])

    @staticmethod
    async def _plugin_id(owner: Client) -> str:
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        return str(next(p for p in apps if p["slug"] == janus_agent.AGENT_SLUG)["id"])

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

    async def test_a_disabled_agent_still_joins(self, janus: None, client: Client) -> None:
        # Disabled is not retired. Leave it out while it is off and the channels founded
        # meanwhile are the rooms it is deaf in once it is switched back on — the hole
        # `_agents_in_every_public_channel` exists to close, reopened by the off switch.
        # It joins and stays quiet.
        owner = await sign_up(client, "Founder")
        plugin_id = await self._plugin_id(owner)
        off = await owner.post(f"/api/admin/plugins/{plugin_id}/enabled", {"enabled": False})
        assert off.status == 200, off.body

        later = await self._found_public(owner, "later")

        assert await self._bot_id(owner) in await self._members_of(owner, later)

    async def test_a_retired_agent_is_not_added(self, janus: None, client: Client) -> None:
        # The other side of the line above: disabled joins, retired does not. Two locks
        # hold it, and `_agents_in_every_public_channel` has both — `uninstall` clears
        # `bot_plugin_id`, which drops the bot from the join onto `plugins`, and it sets
        # `deactivated_at`, which the WHERE clause tests. What is pinned here is the
        # behaviour, not which lock turned: a bot nobody can mention any more must not
        # keep being added to rooms.
        owner = await sign_up(client, "Founder")
        bot = await self._bot_id(owner)
        plugin_id = await self._plugin_id(owner)
        assert (await owner.delete(f"/api/admin/plugins/{plugin_id}")).status == 200

        later = await self._found_public(owner, "later")

        assert bot not in await self._members_of(owner, later)

    async def test_an_agent_somebody_attached_for_themselves_is_not_added(
        self, janus: None, client: Client
    ) -> None:
        # Only the seeder flags an install. A personal agent is listed for its owner
        # alone, and an app an admin installs by hand is invited room by room —
        # membership is also how far its `messages:write` reaches.
        owner = await sign_up(client, "Founder")
        await allow_policy(await workspace_id_of(owner))
        attached = await owner.post("/api/agents/mine", {"name": "Desktop Claude"})
        assert attached.status == 201, attached.body

        later = await self._found_public(owner, "later")

        members = await self._members_of(owner, later)
        people = (await owner.get("/api/users")).body["users"]
        mine = next(u for u in people if u["displayName"] == "Desktop Claude")
        assert mine["id"] not in members
        assert await self._bot_id(owner) in members

    async def test_it_answers_in_a_channel_founded_after_it_was_seeded(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Without the join at founding (commit 1d424d73) this was dropped with no
        # message, no error and no run row — indistinguishable from the agent being down.
        from .test_agent_dm import says
        from .test_agui import agent_speaks, route_agent_to

        owner = await sign_up(client, "Founder")
        transport, seen = agent_speaks(*says("Here too."))
        route_agent_to(monkeypatch, transport)
        later = (await owner.post("/api/channels", {"name": "later", "kind": "public"})).body[
            "channel"
        ]["id"]

        sent = await send_message(owner, later, f"@{settings.JANUS_AGENT_NAME} are you here?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        history = (await owner.get(f"/api/channels/{later}/messages")).body["messages"]
        assert any(m["body"] == "Here too." for m in history)
        assert len(seen) == 1


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


def turn_janus_on(monkeypatch: pytest.MonkeyPatch) -> None:
    """The two settings the `janus` fixture turns on, for a test that has to sign up with
    them off first. (The fixture also pins `JANUS_AGENT_NAME`; `conftest.py` forces that
    one for the whole suite, so these two are what a test can be missing.)"""
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")


async def make_workspace(admin: Client, name: str) -> str:
    response = await admin.post("/api/admin/instance/workspaces", {"name": name})
    assert response.status == 201, response.body
    return str(response.body["id"])


async def owner_of(workspace_id: str) -> str:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT id FROM users WHERE workspace_id = :ws AND role = 'owner'"),
                {"ws": workspace_id},
            )
        ).fetchone()
    assert row is not None
    return str(row.id)


class StandInEnsure:
    """A stand-in for `ensure` that remembers every workspace it was asked about.

    What `TestReconcilingAtBoot` is about is the pass itself — which workspaces it visits,
    whom it installs as, what it counts — and the real `ensure` is pinned by the classes
    above.

    Told to fail, it fails the *first* workspace it is asked about — whichever that is,
    since the pass promises no order — and fails it the way a seeder really would: with a
    statement Postgres refuses, which leaves the transaction it ran in unusable. A
    stand-in that merely raised before touching the session would let a loop that shared
    one session across every workspace pass the same tests.
    """

    def __init__(self, *, fail_first: bool = False, answer: str | None = "a-plugin") -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail_first = fail_first
        self.failed: str | None = None
        self.answer = answer

    async def __call__(
        self, session: AsyncSession, workspace_id: str, *, installed_by: str
    ) -> str | None:
        self.calls.append((workspace_id, installed_by))
        # Every call touches the session it was given, so a session poisoned by an
        # earlier failure is noticed rather than skipped past.
        await session.execute(text("SELECT 1"))
        if self.fail_first and self.failed is None:
            self.failed = workspace_id
            await session.execute(text("SELECT 1/0"))
        return self.answer

    @property
    def visited(self) -> set[str]:
        return {workspace_id for workspace_id, _ in self.calls}


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

        turn_janus_on(monkeypatch)
        assert await janus_agent.ensure_everywhere() >= 1

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert any(p["slug"] == janus_agent.AGENT_SLUG for p in apps)

    async def test_reconciling_twice_seeds_nothing_the_second_time(
        self, janus: None, client: Client
    ) -> None:
        await sign_up(client, "Founder")
        await janus_agent.ensure_everywhere()
        assert await janus_agent.ensure_everywhere() == 0

    async def test_one_workspaces_failure_costs_no_other_its_agent(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The rule the pass exists for. Signed up with Janus off so that neither
        # workspace already holds it, then turned on: both are workspaces the pass has
        # something to do for.
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        turn_janus_on(monkeypatch)
        seeder = StandInEnsure(fail_first=True)
        monkeypatch.setattr(janus_agent, "ensure", seeder)

        seeded = await janus_agent.ensure_everywhere()

        assert seeder.visited == {first, second}
        assert seeder.failed in {first, second}
        # The other one was seeded in a transaction of its own, which is the only way it
        # could have been after the first one's was left in a failed state.
        assert seeded == 1

    async def test_each_workspace_is_seeded_as_its_own_owner(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A person is one user row per workspace, so the founder's id in the first
        # workspace is not who installs in the second.
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        turn_janus_on(monkeypatch)
        seeder = StandInEnsure()
        monkeypatch.setattr(janus_agent, "ensure", seeder)

        await janus_agent.ensure_everywhere()

        installed_by = dict(seeder.calls)
        assert installed_by[first] == founder.user_id
        assert installed_by[second] == await owner_of(second)
        assert installed_by[first] != installed_by[second]

    async def test_a_workspace_with_no_owner_is_left_alone(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE users SET deactivated_at = now() WHERE workspace_id = :ws"),
                    {"ws": second},
                )
        turn_janus_on(monkeypatch)
        seeder = StandInEnsure()
        monkeypatch.setattr(janus_agent, "ensure", seeder)

        await janus_agent.ensure_everywhere()

        assert seeder.visited == {first}

    async def test_a_workspace_that_gained_nothing_is_not_counted(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Counted by the difference between before and after, not by the answer alone:
        # `ensure` returns None when it seeded nothing. Signed up with Janus off on
        # purpose: `existing_id` is the real one here, so the row has to be missing for
        # the tally to have anything to count — with it seeded at signup, 0 would be true
        # for the wrong reason.
        await sign_up(client, "Founder")
        turn_janus_on(monkeypatch)
        seeder = StandInEnsure(answer=None)
        monkeypatch.setattr(janus_agent, "ensure", seeder)

        seeded = await janus_agent.ensure_everywhere()

        assert len(seeder.visited) == 1
        assert seeded == 0


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
