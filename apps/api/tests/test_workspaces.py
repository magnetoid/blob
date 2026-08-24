"""More than one workspace on one server.

A person is several user rows under this model — one per workspace — and the rule holding
that together is *one email, one password, everywhere*. Most of these test that rule from
the angle it breaks from: a sign-in that has to choose between two rows, a reset that has
to reach rows the link was not minted for, a second workspace that must not ask for a new
password.

The other half is separation. Two workspaces on one server share a database and nothing
else, and a member of one must not be able to read, join or administer the other.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    """The first signup: owner of the first workspace, and the server's instance admin."""
    return await sign_up(client, "Founder")


async def make_workspace(admin: Client, name: str) -> dict:
    response = await admin.post("/api/admin/instance/workspaces", {"name": name})
    assert response.status == 201, response.body
    return response.body


# ─── creating ─────────────────────────────────────────────────────────────────
async def test_the_founder_can_create_another_workspace(founder: Client) -> None:
    created = await make_workspace(founder, "Second")
    assert created["name"] == "Second"
    assert created["slug"] == "second"

    listed = (await founder.get("/api/admin/instance/workspaces")).body["workspaces"]
    assert [w["name"] for w in listed] == ["Test Workspace", "Second"]


async def test_a_new_workspace_starts_with_its_creator_and_the_default_channels(
    founder: Client,
) -> None:
    created = await make_workspace(founder, "Second")
    await founder.post(f"/api/workspaces/{created['id']}/switch")

    boot = (await founder.get("/api/bootstrap")).body
    assert boot["workspace"]["name"] == "Second"
    # One person in it. A workspace starts empty of everyone else; that is what an
    # invitation is for.
    assert [u["displayName"] for u in boot["users"]] == ["Founder"]
    assert {c["name"] for c in boot["channels"]} >= {"general", "random"}
    assert boot["user"]["role"] == "owner"


async def test_workspace_slugs_do_not_collide(founder: Client) -> None:
    first = await make_workspace(founder, "Acme")
    second = await make_workspace(founder, "Acme")
    assert first["slug"] == "acme"
    assert second["slug"] == "acme-2"


async def test_only_an_instance_admin_can_create_a_workspace(founder: Client) -> None:
    member = await invite_and_sign_up(founder, "Member")
    admin = await invite_and_sign_up(founder, "Admin", role="admin")

    # Being an admin — even an owner — of a workspace says nothing about the server.
    assert (await member.post("/api/admin/instance/workspaces", {"name": "Nope"})).status == 403
    assert (await admin.post("/api/admin/instance/workspaces", {"name": "Nope"})).status == 403


# ─── belonging to several ─────────────────────────────────────────────────────
async def test_mine_lists_every_workspace_this_person_is_in(founder: Client) -> None:
    await make_workspace(founder, "Second")

    mine = (await founder.get("/api/workspaces/mine")).body["workspaces"]
    assert [w["name"] for w in mine] == ["Test Workspace", "Second"]
    assert [w["current"] for w in mine] == [True, False]
    assert all(w["role"] == "owner" for w in mine)


async def test_a_member_of_one_workspace_sees_only_that_one(founder: Client) -> None:
    await make_workspace(founder, "Second")
    member = await invite_and_sign_up(founder, "Member")

    mine = (await member.get("/api/workspaces/mine")).body["workspaces"]
    assert [w["name"] for w in mine] == ["Test Workspace"]


async def test_switching_moves_the_session_to_the_other_account(founder: Client) -> None:
    created = await make_workspace(founder, "Second")

    before = (await founder.get("/api/bootstrap")).body["user"]["id"]
    switched = (await founder.post(f"/api/workspaces/{created['id']}/switch")).body
    after = (await founder.get("/api/bootstrap")).body

    # A different row for the same person, which is what "switching" is under this model.
    assert switched["userId"] != before
    assert after["user"]["id"] == switched["userId"]
    assert after["workspace"]["name"] == "Second"


async def test_you_cannot_switch_into_a_workspace_you_are_not_in(founder: Client) -> None:
    created = await make_workspace(founder, "Second")
    member = await invite_and_sign_up(founder, "Member")

    response = await member.post(f"/api/workspaces/{created['id']}/switch")
    # 404, not 403: whether an address has an account somewhere it cannot see is not
    # that workspace's business to confirm.
    assert response.status == 404


async def test_a_workspace_cannot_read_another_ones_conversation(founder: Client) -> None:
    created = await make_workspace(founder, "Second")
    member = await invite_and_sign_up(founder, "Member")

    channels = (await member.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    await send_message(member, general["id"], "first workspace only")

    await founder.post(f"/api/workspaces/{created['id']}/switch")
    second = (await founder.get("/api/channels")).body["channels"]
    # Same channel names, different workspace, different rows entirely.
    assert general["id"] not in {c["id"] for c in second}
    assert (await founder.get(f"/api/channels/{general['id']}/messages")).status == 404


# ─── one email, one password ──────────────────────────────────────────────────
async def test_signing_in_lands_somewhere_deterministic(founder: Client) -> None:
    """The bug this model would otherwise hide.

    `WHERE email = :email` matched one row while there was one workspace. With two it
    matches two, and without an ORDER BY the planner picks — so the same person signs
    into a different workspace on different days with nothing to explain it.
    """
    await make_workspace(founder, "Second")

    for _ in range(3):
        fresh = founder.fork()
        response = await fresh.post(
            "/api/auth/login", {"email": "founder@example.com", "password": "correct-horse-battery"}
        )
        assert response.status == 200
        boot = (await fresh.get("/api/bootstrap")).body
        # Their oldest account, every time — the same order `mine` lists them in.
        assert boot["workspace"]["name"] == "Test Workspace"


async def test_a_second_workspace_uses_the_password_they_already_have(
    founder: Client,
) -> None:
    created = await make_workspace(founder, "Second")

    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT workspace_id, password_hash FROM users WHERE email = :e"),
                {"e": "founder@example.com"},
            )
        ).fetchall()

    hashes = {row.password_hash for row in rows}
    assert len(rows) == 2
    # One credential, not one per workspace. A new workspace must never mean a new
    # password to remember.
    assert len(hashes) == 1
    assert created["id"] in {row.workspace_id for row in rows}


async def test_a_new_password_reaches_every_workspace(founder: Client) -> None:
    """A reset writes to every row this address holds, not only the one it was minted for.

    Touching one row would leave the same person locked out of their other workspaces by
    the password they had just chosen — and the reset would have looked like it worked.
    """
    from blob_api.lib.auth import hash_password
    from blob_api.services import workspaces as workspace_service

    await make_workspace(founder, "Second")
    new_hash = await hash_password("a-brand-new-password")

    async with SessionFactory() as session:
        async with session.begin():
            await workspace_service.set_password_everywhere(
                session, "founder@example.com", new_hash
            )
        rows = (
            await session.execute(
                text("SELECT password_hash FROM users WHERE email = :e"),
                {"e": "founder@example.com"},
            )
        ).fetchall()

    assert len(rows) == 2
    assert {row.password_hash for row in rows} == {new_hash}

    fresh = founder.fork()
    response = await fresh.post(
        "/api/auth/login",
        {"email": "founder@example.com", "password": "a-brand-new-password"},
    )
    assert response.status == 200


async def test_the_same_display_name_is_free_in_a_different_workspace(
    founder: Client,
) -> None:
    created = await make_workspace(founder, "Second")
    await invite_and_sign_up(founder, "Taken")

    await founder.post(f"/api/workspaces/{created['id']}/switch")
    # The display-name index is per workspace, so a name used next door is available.
    other = await invite_and_sign_up(founder, "Taken")
    boot = (await other.get("/api/bootstrap")).body
    assert boot["workspace"]["name"] == "Second"


@pytest.mark.parametrize("path", ["/api/admin/instance/users", "/api/admin/instance/workspaces"])
async def test_the_instance_console_is_for_instance_admins(founder: Client, path: str) -> None:
    created = await make_workspace(founder, "Second")
    stranger = await invite_and_sign_up(founder, "Stranger")

    assert (await founder.get(path)).status == 200
    assert (await stranger.get(path)).status == 403

    # And it stays theirs after they move workspace — it is a fact about the person.
    await founder.post(f"/api/workspaces/{created['id']}/switch")
    assert (await founder.get(path)).status == 200
