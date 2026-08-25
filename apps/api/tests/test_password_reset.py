"""Password recovery, end to end.

This path was written, deployed, and never tested. `test_auth.py` had a
`test_password_reset_signs_out_every_session` that signed somebody up and then asserted
only that a forgotten address answers 200 — the reset half, which rewrites a password
across every workspace and deletes every session, ran in no test at all. It moved here
and grew the rest of itself.

The first assertion is the one that matters most to the client: the emailed link's shape
is a contract. `AuthScreen.resetTokenFromUrl` matches `/reset/<token>` off the path, so a
server that changed this URL would keep passing its own tests while every reset email in
the wild quietly stopped working — which is exactly the state this feature was found in,
for the opposite reason.
"""

from __future__ import annotations

import pytest

from blob_api.config import settings
from blob_api.routers import auth as auth_router

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up

NEW_PASSWORD = "a-different-correct-horse"


@pytest.fixture
def sent_links(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Capture reset links instead of mailing them.

    The token never leaves the server any other way — only its hash is stored — so
    intercepting the mail is the only way to test the half that follows the click.
    """
    links: list[str] = []

    async def capture(to: str, url: str) -> None:
        links.append(url)

    monkeypatch.setattr(auth_router, "send_password_reset", capture)
    return links


async def request_reset(client: Client, email: str, links: list[str]) -> str:
    response = await client.post("/api/auth/forgot-password", {"email": email})
    assert response.status == 200, response.body
    assert len(links) == 1, "expected exactly one email"
    return links[-1].rsplit("/", 1)[1]


class TestTheEmail:
    async def test_the_link_is_the_path_the_client_parses(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")
        await client.post("/api/auth/forgot-password", {"email": "owner@example.com"})

        assert len(sent_links) == 1
        url = sent_links[0]
        prefix = f"{settings.PUBLIC_URL}/reset/"
        # Change this and the client's regex stops matching, with nothing failing here
        # and nothing failing there — just a link in an inbox that opens the app and
        # does nothing. That was the bug.
        assert url.startswith(prefix), url
        assert len(url.removeprefix(prefix)) >= 10

    async def test_an_address_nobody_holds_is_answered_the_same_way(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")
        response = await client.post("/api/auth/forgot-password", {"email": "ghost@example.com"})

        # Same status, same shape — otherwise this endpoint enumerates accounts.
        assert response.status == 200
        assert sent_links == []

    async def test_a_deactivated_account_gets_no_link(
        self, client: Client, sent_links: list[str]
    ) -> None:
        owner = await sign_up(client, "Owner")
        member = await invite_and_sign_up(owner, "Member")
        assert (await owner.post(f"/api/admin/users/{member.user_id}/deactivate")).status == 200

        assert (
            await client.post("/api/auth/forgot-password", {"email": "member@example.com"})
        ).status == 200
        # Recovering a password would be a way back into an account somebody closed.
        assert sent_links == []


class TestFollowingTheLink:
    async def test_it_sets_the_password_and_signs_you_in(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")
        token = await request_reset(client, "owner@example.com", sent_links)

        stranger = client.fork()
        response = await stranger.post(
            "/api/auth/reset-password", {"token": token, "password": NEW_PASSWORD}
        )
        assert response.status == 200, response.body

        # Signed in on the spot: somebody who followed a link from their inbox has just
        # proved they hold the address, and asking them to type the password they chose
        # one field ago is a step with nothing behind it.
        assert (await stranger.get("/api/bootstrap")).status == 200

    async def test_the_old_password_stops_working_and_the_new_one_starts(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")
        token = await request_reset(client, "owner@example.com", sent_links)
        await client.post("/api/auth/reset-password", {"token": token, "password": NEW_PASSWORD})

        fresh = client.fork()
        assert (
            await fresh.post(
                "/api/auth/login", {"email": "owner@example.com", "password": PASSWORD}
            )
        ).status == 401
        assert (
            await fresh.post(
                "/api/auth/login", {"email": "owner@example.com", "password": NEW_PASSWORD}
            )
        ).status == 200

    async def test_every_other_session_is_signed_out(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")

        other_device = client.fork()
        assert (
            await other_device.post(
                "/api/auth/login", {"email": "owner@example.com", "password": PASSWORD}
            )
        ).status == 200
        assert (await other_device.get("/api/bootstrap")).status == 200

        token = await request_reset(client, "owner@example.com", sent_links)
        await client.fork().post(
            "/api/auth/reset-password", {"token": token, "password": NEW_PASSWORD}
        )

        # The whole point of resetting a password you have lost control of. A session
        # that outlived the password protecting it is the reset having done nothing.
        assert (await other_device.get("/api/bootstrap")).status == 401
        assert (await client.get("/api/bootstrap")).status == 401

    async def test_the_token_works_once(self, client: Client, sent_links: list[str]) -> None:
        await sign_up(client, "Owner")
        token = await request_reset(client, "owner@example.com", sent_links)

        assert (
            await client.fork().post(
                "/api/auth/reset-password", {"token": token, "password": NEW_PASSWORD}
            )
        ).status == 200

        second = await client.fork().post(
            "/api/auth/reset-password", {"token": token, "password": "third-password-entirely"}
        )
        # A link that stays live is a spare key left in an inbox forever.
        assert second.status == 400

    async def test_a_token_nobody_minted_is_refused(self, client: Client) -> None:
        await sign_up(client, "Owner")
        response = await client.fork().post(
            "/api/auth/reset-password",
            {"token": "not-a-real-token-at-all", "password": NEW_PASSWORD},
        )
        assert response.status == 400

    async def test_a_short_password_is_refused_the_way_signup_refuses_one(
        self, client: Client, sent_links: list[str]
    ) -> None:
        await sign_up(client, "Owner")
        token = await request_reset(client, "owner@example.com", sent_links)

        response = await client.fork().post(
            "/api/auth/reset-password", {"token": token, "password": "short"}
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "invalid_input"
        # Still usable — a rejected password must not burn the link.
        assert (
            await client.fork().post(
                "/api/auth/reset-password", {"token": token, "password": NEW_PASSWORD}
            )
        ).status == 200
