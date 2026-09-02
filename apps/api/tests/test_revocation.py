"""What is supposed to stop working when somebody says stop.

A revoked invitation wrote a row the admin console read back as "revoked" and kept
working: signup filtered on `accepted_at` and `expires_at` and never on `revoked_at`, so
the link an admin had just cancelled still created an account — with whatever role the
invitation named, for up to thirty days. The console said the right thing about it the
whole time, which is why the existing test passed.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, sign_up


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Owner")


async def invite(owner: Client, email: str, role: str = "member") -> tuple[str, str]:
    """Make one and hand back (token, id) — the two halves live in different answers."""
    made = await owner.post("/api/invites", {"email": email, "role": role})
    assert made.status == 200, made.body
    token = str(made.body["url"]).rsplit("/", 1)[-1]

    listing = await owner.get("/api/admin/invites")
    invite_id = next(
        row["id"]
        for row in listing.body["invites"]
        if row["email"] == email and row["status"] == "pending"
    )
    return token, invite_id


async def signup_with(client: Client, token: str, email: str) -> object:
    return await client.fork().post(
        "/api/auth/signup",
        {
            "email": email,
            "password": "correct horse battery",
            "displayName": f"Holder {token[:6]}",
            "inviteToken": token,
        },
    )


class TestARevokedInvitation:
    async def test_cannot_be_used_to_sign_up(self, owner: Client, client: Client) -> None:
        # The one that mattered most: an invitation may name an admin, and a revoked one
        # kept minting one.
        token, invite_id = await invite(owner, "wrong@example.com", role="admin")
        revoked = await owner.delete(f"/api/admin/invites/{invite_id}")
        assert revoked.status == 200, revoked.body

        joined = await signup_with(client, token, "wrong@example.com")

        assert joined.status == 401, joined.body

    async def test_does_not_even_name_the_workspace(self, owner: Client, client: Client) -> None:
        token, invite_id = await invite(owner, "wrong@example.com")
        await owner.delete(f"/api/admin/invites/{invite_id}")

        preview = await client.fork().get(f"/api/invites/{token}")

        assert preview.status == 404, preview.body

    async def test_one_that_stands_still_works(self, owner: Client, client: Client) -> None:
        # The guard has to refuse the revoked one without breaking the ordinary one.
        token, _ = await invite(owner, "right@example.com")

        preview = await client.fork().get(f"/api/invites/{token}")
        joined = await signup_with(client, token, "right@example.com")

        assert preview.status == 200, preview.body
        assert joined.status == 200, joined.body
