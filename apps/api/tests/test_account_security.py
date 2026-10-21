"""A person's own sign-in security (M3 · B1): where they are signed in, what happened to
their account, a password changed while signed in, and confirming it is them before an
action that hands somebody else their reach.

A person is an address, not a row: one account per workspace, one password across all of
them, and a session in one reaches the others through the switcher. So everything here is
tested across two workspaces wherever that is where it could break.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs.retention import sweep_retention
from blob_api.lib.ids import new_id
from blob_api.main import app

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up
from .test_oauth import connect

NEW_PASSWORD = "a-brand-new-password"


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    return await sign_up(client, "Founder")


@pytest_asyncio.fixture
async def outside() -> AsyncIterator[httpx.AsyncClient]:
    """An assistant's own server: no cookie, nothing of the person's."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


async def second_workspace(person: Client, name: str = "Second") -> str:
    made = await person.post("/api/admin/instance/workspaces", {"name": name})
    assert made.status == 201, made.body
    return str(made.body["id"])


async def sign_in(person: Client, email: str, password: str = PASSWORD) -> Client:
    device = person.fork()
    signed_in = await device.post("/api/auth/login", {"email": email, "password": password})
    assert signed_in.status == 200, signed_in.body
    return device


async def go_stale(person: Client) -> None:
    """Every session this person holds last proved who it is an hour ago."""
    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                UPDATE sessions SET reauth_at = now() - interval '1 hour'
                 WHERE user_id IN (SELECT id FROM users WHERE email =
                                   (SELECT email FROM users WHERE id = :id))
                """
            ),
            {"id": person.user_id},
        )


async def kinds(person: Client) -> list[str]:
    activity = await person.get("/api/auth/activity")
    assert activity.status == 200, activity.body
    return [event["kind"] for event in activity.body["events"]]


# ─── where you are signed in ──────────────────────────────────────────────────


class TestSessions:
    async def test_every_workspace_is_listed_with_how_it_signed_in(self, founder: Client) -> None:
        other = await second_workspace(founder)
        laptop = await sign_in(founder, "founder@example.com")
        switched = await laptop.post(f"/api/workspaces/{other}/switch")
        assert switched.status == 200, switched.body

        listed = (await founder.get("/api/auth/sessions")).body["sessions"]
        assert sorted(row["workspace"] for row in listed) == ["Second", "Test Workspace"]
        mine = next(row for row in listed if row["current"])
        assert mine["method"] == "signup"
        theirs = next(row for row in listed if not row["current"])
        # A switch carries the sign-in's method over; it is not a sign-in of its own.
        assert theirs["method"] == "password"

    async def test_one_device_can_be_signed_out(self, founder: Client) -> None:
        laptop = await sign_in(founder, "founder@example.com")
        listed = (await founder.get("/api/auth/sessions")).body["sessions"]
        target = next(row for row in listed if not row["current"])

        ended = await founder.delete(f"/api/auth/sessions/{target['id']}")
        assert ended.status == 200, ended.body
        assert (await laptop.get("/api/auth/sessions")).status == 401
        assert (await founder.get("/api/auth/sessions")).status == 200
        assert "session_ended" in await kinds(founder)

    async def test_somebody_elses_session_is_not_yours_to_end(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        theirs = (await member.get("/api/auth/sessions")).body["sessions"][0]

        refused = await founder.delete(f"/api/auth/sessions/{theirs['id']}")
        assert refused.status == 404
        assert (await member.get("/api/auth/sessions")).status == 200

    async def test_everywhere_else_reaches_the_other_workspaces(self, founder: Client) -> None:
        """The hole this closes: a session in one workspace switches into the others
        without a password, so signing out from one had to sign out all of them."""
        other = await second_workspace(founder)
        stolen = await sign_in(founder, "founder@example.com")
        assert (await stolen.post(f"/api/workspaces/{other}/switch")).status == 200

        signed_out = await founder.post("/api/auth/logout-others")
        assert signed_out.status == 200, signed_out.body
        assert (await stolen.get("/api/auth/sessions")).status == 401
        assert (await founder.get("/api/auth/sessions")).status == 200
        assert "signed_out_elsewhere" in await kinds(founder)

    async def test_everywhere_else_ends_a_signed_in_assistant_for_good(
        self, founder: Client, outside: httpx.AsyncClient
    ) -> None:
        """Its access token was already revoked; its refresh token used to bring it back."""
        client_id, issued = await connect(outside, founder)
        assert (await founder.post("/api/auth/logout-others")).status == 200

        refreshed = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        assert refreshed.status_code == 400, refreshed.text
        assert refreshed.json()["error"] == "invalid_grant"


# ─── what happened to the account ─────────────────────────────────────────────


class TestActivity:
    async def test_sign_ins_and_failures_are_on_the_record(self, founder: Client) -> None:
        stranger = founder.fork()
        wrong = await stranger.post(
            "/api/auth/login", {"email": "founder@example.com", "password": "not-the-one"}
        )
        assert wrong.status == 401
        await sign_in(founder, "founder@example.com")

        events = (await founder.get("/api/auth/activity")).body
        assert events["keepDays"] == 90
        newest_first = [(event["kind"], event["method"]) for event in events["events"]]
        assert newest_first == [
            ("signed_in", "password"),
            ("failed", "password"),
            ("signed_in", "signup"),
        ]
        assert all(event["workspace"] == "Test Workspace" for event in events["events"])

    async def test_an_unknown_address_leaves_no_record(self, founder: Client) -> None:
        stranger = founder.fork()
        await stranger.post("/api/auth/login", {"email": "ghost@example.com", "password": "x"})
        async with SessionFactory() as session:
            count = (await session.execute(text("SELECT count(*) FROM account_events"))).scalar()
        assert count == 1  # the founder's own signup

    async def test_another_persons_record_is_not_shown(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        stranger = founder.fork()
        await stranger.post(
            "/api/auth/login", {"email": "founder@example.com", "password": "not-the-one"}
        )
        assert "failed" not in await kinds(member)

    async def test_old_events_are_swept(self, founder: Client) -> None:
        async with transaction() as (session, _):
            await session.execute(
                text(
                    """
                    INSERT INTO account_events (id, email, user_id, kind, created_at)
                    VALUES (:id, 'founder@example.com', :user, 'signed_in',
                            now() - interval '91 days')
                    """
                ),
                {"id": new_id(), "user": founder.user_id},
            )
        counts = await sweep_retention()
        assert counts["account_events"] == 1
        assert await kinds(founder) == ["signed_in"]


# ─── a new password ───────────────────────────────────────────────────────────


class TestChangingThePassword:
    async def test_the_current_one_is_the_proof(self, founder: Client) -> None:
        refused = await founder.post(
            "/api/auth/password", {"currentPassword": "not-the-one", "newPassword": NEW_PASSWORD}
        )
        assert refused.status == 400
        assert refused.body["error"]["code"] == "wrong_password"
        assert refused.body["error"]["field"] == "currentPassword"
        assert "failed" in await kinds(founder)

    async def test_everywhere_else_is_signed_out_and_every_workspace_takes_it(
        self, founder: Client
    ) -> None:
        await second_workspace(founder)
        laptop = await sign_in(founder, "founder@example.com")

        changed = await founder.post(
            "/api/auth/password", {"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}
        )
        assert changed.status == 200, changed.body
        assert (await laptop.get("/api/auth/sessions")).status == 401
        assert (await founder.get("/api/auth/sessions")).status == 200

        stale = founder.fork()
        old = await stale.post(
            "/api/auth/login", {"email": "founder@example.com", "password": PASSWORD}
        )
        assert old.status == 401
        await sign_in(founder, "founder@example.com", NEW_PASSWORD)
        async with SessionFactory() as session:
            hashes = (
                await session.execute(
                    text(
                        "SELECT count(DISTINCT password_hash) FROM users"
                        " WHERE email = 'founder@example.com'"
                    )
                )
            ).scalar()
        assert hashes == 1, "one email, one password — in every workspace"
        assert "password_changed" in await kinds(founder)

    async def test_assistants_stay_connected(self, founder: Client) -> None:
        minted = await founder.post("/api/me/mcp-tokens", {"name": "Editor"})
        assert minted.status == 200, minted.body
        await founder.post(
            "/api/auth/password", {"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}
        )
        listed = (await founder.get("/api/me/mcp-tokens")).body["tokens"]
        assert [token["name"] for token in listed] == ["Editor"]

    async def test_a_password_reset_ends_a_signed_in_assistant_too(
        self, founder: Client, outside: httpx.AsyncClient
    ) -> None:
        client_id, issued = await connect(outside, founder)
        async with transaction() as (session, _):
            await session.execute(
                text(
                    """
                    INSERT INTO password_resets (id, user_id, token_hash, expires_at)
                    VALUES (:id, :user, :hash, now() + interval '1 hour')
                    """
                ),
                {"id": new_id(), "user": founder.user_id, "hash": _hashed("a-reset-token")},
            )
        reset = await founder.fork().post(
            "/api/auth/reset-password", {"token": "a-reset-token", "password": NEW_PASSWORD}
        )
        assert reset.status == 200, reset.body
        refreshed = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        assert refreshed.status_code == 400, refreshed.text


# ─── confirming it is you ─────────────────────────────────────────────────────


class TestConfirming:
    async def test_minting_a_token_asks_once_the_sign_in_is_old(self, founder: Client) -> None:
        await go_stale(founder)
        refused = await founder.post("/api/me/mcp-tokens", {"name": "Editor"})
        assert refused.status == 403
        assert refused.body["error"]["code"] == "reauth_required"

        state = (await founder.get("/api/auth/reauth")).body
        assert state == {
            "methods": ["password"],
            "provenAt": None,
            "windowMinutes": 15,
            "providers": [],
        }

        confirmed = await founder.post("/api/auth/reauth", {"password": PASSWORD})
        assert confirmed.status == 200, confirmed.body
        assert (await founder.get("/api/auth/reauth")).body["provenAt"] is not None
        minted = await founder.post("/api/me/mcp-tokens", {"name": "Editor"})
        assert minted.status == 200, minted.body
        assert "confirmed" in await kinds(founder)

    async def test_a_wrong_password_is_a_400_and_on_the_record(self, founder: Client) -> None:
        await go_stale(founder)
        wrong = await founder.post("/api/auth/reauth", {"password": "not-the-one"})
        assert wrong.status == 400, "a 401 would sign the client out for a typo"
        assert wrong.body["error"]["code"] == "wrong_password"
        assert (await founder.post("/api/me/mcp-tokens", {"name": "Editor"})).status == 403
        assert "failed" in await kinds(founder)

    async def test_switching_workspaces_does_not_freshen_a_session(self, founder: Client) -> None:
        other = await second_workspace(founder)
        await go_stale(founder)
        assert (await founder.post(f"/api/workspaces/{other}/switch")).status == 200
        refused = await founder.post("/api/me/mcp-tokens", {"name": "Editor"})
        assert refused.status == 403
        assert refused.body["error"]["code"] == "reauth_required"

    async def test_reads_and_ordinary_writes_never_ask(self, founder: Client) -> None:
        await go_stale(founder)
        assert (await founder.get("/api/me/mcp-tokens")).status == 200
        assert (await founder.post("/api/invites", {"role": "member"})).status == 200

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [
            ("POST", "/api/invites", {"role": "admin"}),
            ("POST", "/api/admin/plugins", None),
            ("POST", "/api/agents/mine", {"name": "Laptop agent"}),
        ],
    )
    async def test_handing_out_reach_asks(
        self, founder: Client, method: str, path: str, body: Any
    ) -> None:
        await go_stale(founder)
        refused = await founder.request(method, path, body if body is not None else {})
        assert refused.status == 403, refused.body
        assert refused.body["error"]["code"] == "reauth_required"

    async def test_role_changes_and_reset_links_ask(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        await go_stale(founder)
        role = await founder.put(f"/api/admin/users/{member.user_id}/role", {"role": "admin"})
        assert role.body["error"]["code"] == "reauth_required"
        link = await founder.post(f"/api/admin/users/{member.user_id}/reset-link")
        assert link.body["error"]["code"] == "reauth_required"

    async def test_approving_an_assistant_asks_but_declining_does_not(
        self, founder: Client, outside: httpx.AsyncClient
    ) -> None:
        from .test_oauth import ask, pkce, query, register

        client_id = await register(outside)
        _verifier, challenge = pkce()
        asked = await ask(founder, query(client_id, challenge))
        request_id = asked.body["request"]["id"]
        await go_stale(founder)

        approve = await founder.post(f"/api/oauth/requests/{request_id}", {"approve": True})
        assert approve.body["error"]["code"] == "reauth_required"
        decline = await founder.post(f"/api/oauth/requests/{request_id}", {"approve": False})
        assert decline.status == 200, decline.body

    async def test_a_reset_or_a_sign_in_is_a_fresh_proof(self, founder: Client) -> None:
        laptop = await sign_in(founder, "founder@example.com")
        assert (await laptop.post("/api/me/mcp-tokens", {"name": "Editor"})).status == 200


def _hashed(token: str) -> str:
    from blob_api.lib.auth import hash_token

    return hash_token(token)
