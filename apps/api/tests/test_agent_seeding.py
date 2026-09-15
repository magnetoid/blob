"""The pass a seeder makes over every workspace at boot.

Driven with a stand-in seeder rather than the real one — that is pinned by
`test_janus_agent.py` — because what is under test here is the loop itself: which
workspaces it visits, whom it installs as, what it counts, and the rule it exists for,
that one workspace which cannot be seeded costs no other workspace its agent.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.services import agent_seeding, janus_agent

from .helpers import Client, sign_up, workspace_id_of


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


async def nothing_installed(session: AsyncSession, workspace_id: str) -> str | None:
    return None


def janus_running(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one real seeder these tests borrow, for a workspace that holds a slug."""
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")


async def seed_janus_into(workspace_id: str, installed_by: str) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            assert await janus_agent.ensure(session, workspace_id, installed_by=installed_by)


class Seeder:
    """A seeder that remembers every workspace it was asked about.

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


class TestOneWorkspaceCostsNoOtherItsAgent:
    async def test_a_failure_is_skipped_and_the_rest_are_still_seeded(self, client: Client) -> None:
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        seeder = Seeder(fail_first=True)

        seeded = await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=nothing_installed, ensure=seeder
        )

        assert seeder.visited == {first, second}
        assert seeder.failed in {first, second}
        # The other one was seeded in a transaction of its own, which is the only way it
        # could have been after the first one's was left in a failed state.
        assert seeded == 1

    async def test_each_workspace_is_seeded_as_its_own_owner(self, client: Client) -> None:
        # A person is one user row per workspace, so the founder's id in the first
        # workspace is not who installs in the second.
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        seeder = Seeder()

        await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=nothing_installed, ensure=seeder
        )

        installed_by = dict(seeder.calls)
        assert installed_by[first] == founder.user_id
        assert installed_by[second] == await owner_of(second)
        assert installed_by[first] != installed_by[second]

    async def test_a_workspace_with_no_owner_is_left_alone(self, client: Client) -> None:
        founder = await sign_up(client, "Founder")
        first = await workspace_id_of(founder)
        second = await make_workspace(founder, "Second")
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE users SET deactivated_at = now() WHERE workspace_id = :ws"),
                    {"ws": second},
                )
        seeder = Seeder()

        await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=nothing_installed, ensure=seeder
        )

        assert seeder.visited == {first}


class TestWhatIsCounted:
    async def test_a_workspace_that_gained_nothing_is_not_counted(self, client: Client) -> None:
        await sign_up(client, "Founder")
        seeder = Seeder(answer=None)

        seeded = await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=nothing_installed, ensure=seeder
        )

        assert len(seeder.visited) == 1
        assert seeded == 0

    async def test_a_workspace_that_already_had_it_is_not_counted(self, client: Client) -> None:
        # `ensure` returns the id of a row that was already there, so the answer alone
        # cannot tell a restart from a first boot; the difference can.
        await sign_up(client, "Founder")

        async def already_there(session: AsyncSession, workspace_id: str) -> str | None:
            return "a-plugin"

        seeded = await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=already_there, ensure=Seeder(answer="a-plugin")
        )

        assert seeded == 0


class TestTheSlugPrefilter:
    async def test_the_workspace_holding_the_slug_is_skipped_and_the_others_are_not(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Two workspaces, one of them holding the slug. Correlated per workspace: a filter
        # that asked "does any workspace hold it" would skip every workspace on the
        # instance the moment one of them had the agent, silently, reading as "already
        # reconciled".
        founder = await sign_up(client, "Founder")
        holding = await workspace_id_of(founder)
        other = await make_workspace(founder, "Second")
        janus_running(monkeypatch)
        await seed_janus_into(holding, founder.user_id)
        seeder = Seeder()

        seeded = await agent_seeding.reconcile_everywhere(
            "a stand-in",
            existing_id=nothing_installed,
            ensure=seeder,
            lacking_slug=janus_agent.AGENT_SLUG,
        )

        assert seeder.visited == {other}
        assert seeded == 1

    async def test_without_it_every_workspace_is_visited(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        founder = await sign_up(client, "Founder")
        holding = await workspace_id_of(founder)
        other = await make_workspace(founder, "Second")
        janus_running(monkeypatch)
        await seed_janus_into(holding, founder.user_id)
        seeder = Seeder()

        await agent_seeding.reconcile_everywhere(
            "a stand-in", existing_id=nothing_installed, ensure=seeder
        )

        assert seeder.visited == {holding, other}
