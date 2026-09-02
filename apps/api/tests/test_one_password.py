"""One email is one person, with one password.

`services/workspaces` exists to keep that rule, and joining a second workspace *by
invitation* was the one path that broke it: it hashed whatever password the person typed
into the join form and wrote that, so they ended up with two different hashes for one
address. It looked like it worked — the account was created and a cookie came back. The
next sign-in picked their oldest row, checked the new password against the old hash and
said "That email or password is incorrect", with nothing on screen to explain why.

Creating a workspace as an instance admin always copied the hash; being invited to one
did not, and no test covered the second path.
"""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory

from .helpers import PASSWORD, Client, sign_up


@pytest_asyncio.fixture
async def two_workspaces(client: Client) -> dict:
    """A founder who owns two workspaces, and somebody who is in the first."""
    founder = await sign_up(client, "Founder")
    second = await founder.post("/api/admin/instance/workspaces", {"name": "Second"})
    assert second.status == 201, second.body

    joiner = client.fork()
    invited = await founder.post("/api/invites", {"email": "joiner@example.com"})
    token = str(invited.body["url"]).rsplit("/", 1)[-1]
    await sign_up(joiner, "Joiner", invite_token=token, email="joiner@example.com")

    switched = await founder.post(f"/api/workspaces/{second.body['id']}/switch")
    assert switched.status == 200, switched.body
    return {"founder": founder, "joiner": joiner, "second": second.body["id"]}


async def invite_from_the_second(founder: Client, email: str) -> str:
    made = await founder.post("/api/invites", {"email": email})
    assert made.status == 200, made.body
    return str(made.body["url"]).rsplit("/", 1)[-1]


async def hashes_for(email: str) -> set[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT password_hash FROM users WHERE email = :e"), {"e": email}
            )
        ).fetchall()
    return {row.password_hash for row in rows}


class TestJoiningASecondWorkspace:
    async def test_the_password_they_already_have_is_the_one_that_works(
        self, two_workspaces: dict, client: Client
    ) -> None:
        token = await invite_from_the_second(two_workspaces["founder"], "joiner@example.com")

        joined = await client.fork().post(
            "/api/auth/signup",
            {
                "email": "joiner@example.com",
                "password": PASSWORD,
                "displayName": "Joiner",
                "inviteToken": token,
            },
        )

        assert joined.status == 200, joined.body
        # One credential across both rows, which is the rule. Two would mean the older
        # one silently wins at the next sign-in.
        assert len(await hashes_for("joiner@example.com")) == 1

    async def test_a_different_password_is_refused_rather_than_stored(
        self, two_workspaces: dict, client: Client
    ) -> None:
        token = await invite_from_the_second(two_workspaces["founder"], "joiner@example.com")

        joined = await client.fork().post(
            "/api/auth/signup",
            {
                "email": "joiner@example.com",
                "password": "a completely different password",
                "displayName": "Joiner",
                "inviteToken": token,
            },
        )

        assert joined.status == 400, joined.body
        # Refused, not silently overwritten either way. Taking the new password would
        # let whoever holds an invite link change the password on that person's account
        # in a workspace they have nothing to do with.
        assert len(await hashes_for("joiner@example.com")) == 1

    async def test_and_they_can_still_sign_in_afterwards(
        self, two_workspaces: dict, client: Client
    ) -> None:
        token = await invite_from_the_second(two_workspaces["founder"], "joiner@example.com")
        await client.fork().post(
            "/api/auth/signup",
            {
                "email": "joiner@example.com",
                "password": PASSWORD,
                "displayName": "Joiner",
                "inviteToken": token,
            },
        )

        back = await client.fork().post(
            "/api/auth/login", {"email": "joiner@example.com", "password": PASSWORD}
        )

        assert back.status == 200, back.body

    async def test_a_brand_new_address_still_chooses_its_own(
        self, two_workspaces: dict, client: Client
    ) -> None:
        # The guard must not turn every invitation into "use your existing password".
        token = await invite_from_the_second(two_workspaces["founder"], "stranger@example.com")

        joined = await client.fork().post(
            "/api/auth/signup",
            {
                "email": "stranger@example.com",
                "password": "a password of their own",
                "displayName": "Stranger",
                "inviteToken": token,
            },
        )

        assert joined.status == 200, joined.body
