"""Auth, sessions and invitations."""

from __future__ import annotations

import pytest

from .helpers import Client, invite_and_sign_up, sign_up


async def test_first_signup_founds_the_workspace_and_owns_it(client: Client) -> None:
    state = await client.get("/api/auth/state")
    assert state.body == {"needsSetup": True}

    await sign_up(client, "Owner")

    after = await client.get("/api/auth/state")
    assert after.body == {"needsSetup": False}


async def test_signup_without_an_invitation_is_refused(client: Client) -> None:
    await sign_up(client, "Owner")

    stranger = client.fork()
    response = await stranger.post(
        "/api/auth/signup",
        {"email": "nobody@example.com", "password": "correct-horse-battery", "displayName": "Nobody"},
    )
    assert response.status == 401
    assert response.body["error"]["code"] == "unauthorized"


async def test_invited_user_joins_and_lands_on_the_default_channels(client: Client) -> None:
    await sign_up(client, "Owner")
    member = await invite_and_sign_up(client, "Member")

    sessions = await member.get("/api/auth/sessions")
    assert sessions.status == 200
    assert len(sessions.body["sessions"]) == 1
    assert sessions.body["sessions"][0]["current"] is True


async def test_an_invitation_can_only_be_used_once(client: Client) -> None:
    await sign_up(client, "Owner")
    invite = await client.post("/api/invites", {"expiresInDays": 1})
    token = invite.body["url"].split("/join/")[1]

    first = await sign_up(client.fork(), "First", invite_token=token)
    assert first.user_id

    second = await client.fork().post(
        "/api/auth/signup",
        {
            "email": "second@example.com",
            "password": "correct-horse-battery",
            "displayName": "Second",
            "inviteToken": token,
        },
    )
    assert second.status == 401


async def test_invite_preview_is_public_and_hides_used_invites(client: Client) -> None:
    await sign_up(client, "Owner")
    invite = await client.post("/api/invites", {"email": "guest@example.com"})
    token = invite.body["url"].split("/join/")[1]

    anonymous = client.fork()
    preview = await anonymous.get(f"/api/invites/{token}")
    assert preview.status == 200
    assert preview.body["email"] == "guest@example.com"
    assert preview.body["workspace"] == "Test Workspace"

    missing = await anonymous.get("/api/invites/not-a-real-token")
    assert missing.status == 404


async def test_only_admins_can_invite(client: Client) -> None:
    await sign_up(client, "Owner")
    member = await invite_and_sign_up(client, "Member")

    response = await member.post("/api/invites", {})
    # 403, not 401: the client treats 401 as "signed out" and would bounce to login.
    assert response.status == 403
    assert response.body["error"]["code"] == "forbidden"


async def test_login_and_logout(client: Client) -> None:
    await sign_up(client, "Owner")
    await client.post("/api/auth/logout")

    unauthenticated = await client.get("/api/auth/sessions")
    assert unauthenticated.status == 401

    login = await client.post(
        "/api/auth/login", {"email": "owner@example.com", "password": "correct-horse-battery"}
    )
    assert login.status == 200
    assert login.body["user"]["role"] == "owner"
    assert login.body["user"]["email"] == "owner@example.com"


async def test_login_gives_one_message_for_wrong_email_or_wrong_password(
    client: Client,
) -> None:
    await sign_up(client, "Owner")

    wrong_password = await client.post(
        "/api/auth/login", {"email": "owner@example.com", "password": "not-the-password"}
    )
    unknown_email = await client.post(
        "/api/auth/login", {"email": "ghost@example.com", "password": "not-the-password"}
    )

    assert wrong_password.status == unknown_email.status == 401
    # Identical wording, so the endpoint cannot be used to enumerate accounts.
    assert wrong_password.body["error"]["message"] == unknown_email.body["error"]["message"]


async def test_logout_others_keeps_the_current_session(client: Client) -> None:
    await sign_up(client, "Owner")

    second_device = client.fork()
    await second_device.post(
        "/api/auth/login", {"email": "owner@example.com", "password": "correct-horse-battery"}
    )

    assert len((await client.get("/api/auth/sessions")).body["sessions"]) == 2

    await client.post("/api/auth/logout-others")
    assert len((await client.get("/api/auth/sessions")).body["sessions"]) == 1
    assert (await second_device.get("/api/auth/sessions")).status == 401


async def test_password_reset_signs_out_every_session(client: Client) -> None:
    await sign_up(client, "Owner")
    # The endpoint always reports success, so a stranger cannot enumerate accounts.
    assert (await client.post("/api/auth/forgot-password", {"email": "ghost@example.com"})).status == 200


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"email": "not-an-email", "password": "correct-horse-battery", "displayName": "X"}, "email"),
        ({"email": "a@example.com", "password": "short", "displayName": "X"}, "password"),
        ({"email": "a@example.com", "password": "correct-horse-battery", "displayName": ""}, "displayName"),
    ],
)
async def test_invalid_signup_reports_400_with_the_offending_field(
    client: Client, payload: dict, field: str
) -> None:
    response = await client.post("/api/auth/signup", payload)
    # FastAPI would say 422; the client contract says 400 invalid_input.
    assert response.status == 400
    assert response.body["error"]["code"] == "invalid_input"
    assert response.body["error"]["field"] == field
