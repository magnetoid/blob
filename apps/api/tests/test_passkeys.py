"""Passkeys (M3 · B1, ADR 0032): adding one, signing in with one alone, confirming it is
you with one, and asking for one after the password.

`SoftPasskey` answers each ceremony the way a browser and an authenticator would, so these
walk the real verification — challenge, origin, relying party, user verification, the
signature, the counter — with nothing faked on Blob's side.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up
from .webauthn_fake import SoftPasskey


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    return await sign_up(client, "Founder")


async def add_passkey(
    person: Client, key: SoftPasskey | None = None, name: str = "Laptop"
) -> SoftPasskey:
    key = key or SoftPasskey()
    options = await person.post("/api/auth/passkeys/options")
    assert options.status == 200, options.body
    added = await person.post(
        "/api/auth/passkeys",
        {"credential": key.create(options.body["options"]), "name": name},
    )
    assert added.status == 201, added.body
    return key


async def sign_in_with(device: Client, key: SoftPasskey, **answer: Any) -> Any:
    challenge = await device.post("/api/auth/passkey/options")
    assert challenge.status == 200, challenge.body
    return await device.post(
        "/api/auth/passkey/sign-in",
        {
            "flowId": challenge.body["flowId"],
            "credential": key.get(challenge.body["options"], **answer),
        },
    )


async def go_stale(person: Client) -> None:
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


async def kinds(person: Client) -> list[tuple[str, str | None]]:
    events = (await person.get("/api/auth/activity")).body["events"]
    return [(event["kind"], event["method"]) for event in events]


# ─── adding one ───────────────────────────────────────────────────────────────


class TestAdding:
    async def test_a_passkey_is_added_and_listed(self, founder: Client) -> None:
        await add_passkey(founder, name="MacBook")
        listed = (await founder.get("/api/auth/passkeys")).body
        assert [key["name"] for key in listed["passkeys"]] == ["MacBook"]
        assert listed["passkeys"][0]["backedUp"] is True
        assert listed["twoStep"] is False
        assert ("passkey_added", "passkey") in await kinds(founder)
        # And it is now a way to confirm it is you.
        assert (await founder.get("/api/auth/reauth")).body["methods"] == ["password", "passkey"]

    async def test_adding_one_needs_a_fresh_sign_in(self, founder: Client) -> None:
        await go_stale(founder)
        refused = await founder.post("/api/auth/passkeys/options")
        assert refused.body["error"]["code"] == "reauth_required"

    async def test_an_answer_from_another_site_is_refused(self, founder: Client) -> None:
        options = await founder.post("/api/auth/passkeys/options")
        key = SoftPasskey()
        wrong = await founder.post(
            "/api/auth/passkeys",
            {"credential": key.create(options.body["options"], origin="https://evil.example")},
        )
        assert wrong.status == 400
        assert wrong.body["error"]["code"] == "passkey_refused"
        # The challenge was spent by that attempt: a second answer to it starts over.
        again = await founder.post(
            "/api/auth/passkeys", {"credential": key.create(options.body["options"])}
        )
        assert again.status == 400
        assert "took too long" in again.body["error"]["message"]

    async def test_a_key_that_did_not_check_who_is_holding_it_is_refused(
        self, founder: Client
    ) -> None:
        options = await founder.post("/api/auth/passkeys/options")
        unverified = await founder.post(
            "/api/auth/passkeys",
            {"credential": SoftPasskey().create(options.body["options"], verified=False)},
        )
        assert unverified.body["error"]["code"] == "passkey_refused"

    async def test_the_same_key_twice_is_a_conflict(self, founder: Client) -> None:
        key = await add_passkey(founder)
        options = await founder.post("/api/auth/passkeys/options")
        # The browser is told to refuse it; a client that ignores that is refused here.
        assert key.credential_id in {
            __import__("webauthn").helpers.base64url_to_bytes(item["id"])
            for item in options.body["options"]["excludeCredentials"]
        }
        twice = await founder.post(
            "/api/auth/passkeys", {"credential": key.create(options.body["options"])}
        )
        assert twice.status == 409

    async def test_renaming_and_removing(self, founder: Client) -> None:
        await add_passkey(founder)
        passkey_id = (await founder.get("/api/auth/passkeys")).body["passkeys"][0]["id"]
        renamed = await founder.patch(f"/api/auth/passkeys/{passkey_id}", {"name": "Old phone"})
        assert renamed.status == 200
        removed = await founder.delete(f"/api/auth/passkeys/{passkey_id}")
        assert removed.status == 200, removed.body
        assert removed.body["credentialId"]
        assert (await founder.get("/api/auth/passkeys")).body["passkeys"] == []
        assert ("passkey_removed", "passkey") in await kinds(founder)

    async def test_somebody_elses_passkey_is_not_yours_to_touch(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        await add_passkey(member)
        theirs = (await member.get("/api/auth/passkeys")).body["passkeys"][0]["id"]
        assert (await founder.patch(f"/api/auth/passkeys/{theirs}", {"name": "x"})).status == 404
        assert (await founder.delete(f"/api/auth/passkeys/{theirs}")).status == 404


# ─── signing in with one ──────────────────────────────────────────────────────


class TestSigningIn:
    async def test_a_passkey_alone_signs_you_in(self, founder: Client) -> None:
        key = await add_passkey(founder)
        device = founder.fork()
        signed_in = await sign_in_with(device, key)
        assert signed_in.status == 200, signed_in.body
        assert signed_in.body["user"]["id"] == founder.user_id
        sessions = (await device.get("/api/auth/sessions")).body["sessions"]
        assert next(row for row in sessions if row["current"])["method"] == "passkey"
        assert ("signed_in", "passkey") in await kinds(founder)

    async def test_it_lands_where_a_password_would(self, founder: Client) -> None:
        key = await add_passkey(founder)
        made = await founder.post("/api/admin/instance/workspaces", {"name": "Second"})
        assert made.status == 201
        # Switched into the second workspace and added there — still one person's key.
        await founder.post(f"/api/workspaces/{made.body['id']}/switch")
        signed_in = await sign_in_with(founder.fork(), key)
        assert signed_in.body["user"]["id"] == founder.user_id  # the first, oldest account

    async def test_an_unknown_key_says_so(self, founder: Client) -> None:
        refused = await sign_in_with(founder.fork(), SoftPasskey())
        assert refused.status == 400
        assert refused.body["error"]["code"] == "passkey_unknown"

    async def test_a_removed_key_opens_nothing(self, founder: Client) -> None:
        key = await add_passkey(founder)
        passkey_id = (await founder.get("/api/auth/passkeys")).body["passkeys"][0]["id"]
        await founder.delete(f"/api/auth/passkeys/{passkey_id}")
        refused = await sign_in_with(founder.fork(), key)
        assert refused.body["error"]["code"] == "passkey_unknown"

    async def test_a_challenge_answers_once(self, founder: Client) -> None:
        key = await add_passkey(founder)
        device = founder.fork()
        challenge = await device.post("/api/auth/passkey/options")
        answer = key.get(challenge.body["options"])
        first = await device.post(
            "/api/auth/passkey/sign-in", {"flowId": challenge.body["flowId"], "credential": answer}
        )
        assert first.status == 200
        replayed = await founder.fork().post(
            "/api/auth/passkey/sign-in", {"flowId": challenge.body["flowId"], "credential": answer}
        )
        assert replayed.status == 400

    async def test_an_answer_to_another_challenge_is_refused(self, founder: Client) -> None:
        key = await add_passkey(founder)
        device = founder.fork()
        one = await device.post("/api/auth/passkey/options")
        other = await device.post("/api/auth/passkey/options")
        crossed = await device.post(
            "/api/auth/passkey/sign-in",
            {"flowId": other.body["flowId"], "credential": key.get(one.body["options"])},
        )
        assert crossed.body["error"]["code"] == "passkey_refused"

    async def test_a_cloned_key_is_caught_by_its_counter(self, founder: Client) -> None:
        key = await add_passkey(founder)
        assert (await sign_in_with(founder.fork(), key)).status == 200
        key.sign_count = 0  # a copy of the key, behind the original
        refused = await sign_in_with(founder.fork(), key)
        assert refused.body["error"]["code"] == "passkey_refused"

    async def test_signing_in_with_a_passkey_alone_needs_the_device_unlocked(
        self, founder: Client
    ) -> None:
        key = await add_passkey(founder)
        refused = await sign_in_with(founder.fork(), key, verified=False)
        assert refused.body["error"]["code"] == "passkey_refused"

    async def test_a_key_made_for_another_site_is_refused(self, founder: Client) -> None:
        key = await add_passkey(founder)
        refused = await sign_in_with(founder.fork(), key, rp_id="evil.example")
        assert refused.body["error"]["code"] == "passkey_refused"

    async def test_a_deactivated_account_stays_out(self, founder: Client) -> None:
        member = await invite_and_sign_up(founder, "Member")
        key = await add_passkey(member)
        assert (await founder.post(f"/api/admin/users/{member.user_id}/deactivate")).status == 200
        refused = await sign_in_with(member.fork(), key)
        assert refused.status == 401


# ─── confirming it is you with one ────────────────────────────────────────────


class TestConfirming:
    async def test_a_passkey_confirms_for_the_next_quarter_hour(self, founder: Client) -> None:
        key = await add_passkey(founder)
        await go_stale(founder)
        assert (await founder.post("/api/me/mcp-tokens", {"name": "Editor"})).status == 403

        challenge = await founder.post("/api/auth/reauth/passkey/options")
        confirmed = await founder.post(
            "/api/auth/reauth/passkey",
            {"flowId": challenge.body["flowId"], "credential": key.get(challenge.body["options"])},
        )
        assert confirmed.status == 200, confirmed.body
        assert (await founder.post("/api/me/mcp-tokens", {"name": "Editor"})).status == 200
        assert ("confirmed", "passkey") in await kinds(founder)

    async def test_somebody_elses_passkey_confirms_nothing(self, founder: Client) -> None:
        await add_passkey(founder)
        member = await invite_and_sign_up(founder, "Member")
        theirs = await add_passkey(member)
        challenge = await founder.post("/api/auth/reauth/passkey/options")
        refused = await founder.post(
            "/api/auth/reauth/passkey",
            {
                "flowId": challenge.body["flowId"],
                "credential": theirs.get(challenge.body["options"]),
            },
        )
        assert refused.body["error"]["code"] == "passkey_refused"

    async def test_a_confirmation_is_for_the_session_that_asked(self, founder: Client) -> None:
        key = await add_passkey(founder)
        laptop = founder.fork()
        await laptop.post("/api/auth/login", {"email": "founder@example.com", "password": PASSWORD})
        challenge = await founder.post("/api/auth/reauth/passkey/options")
        carried = await laptop.post(
            "/api/auth/reauth/passkey",
            {"flowId": challenge.body["flowId"], "credential": key.get(challenge.body["options"])},
        )
        assert carried.status == 400


# ─── a passkey after the password ─────────────────────────────────────────────


async def turn_on_two_step(person: Client) -> SoftPasskey:
    key = await add_passkey(person)
    turned = await person.put("/api/auth/two-step", {"on": True})
    assert turned.status == 200, turned.body
    return key


class TestTwoStep:
    async def test_it_needs_a_passkey_to_ask_for(self, founder: Client) -> None:
        refused = await founder.put("/api/auth/two-step", {"on": True})
        assert refused.status == 400

    async def test_a_right_password_is_half_a_sign_in(self, founder: Client) -> None:
        key = await turn_on_two_step(founder)
        device = founder.fork()
        half = await device.post(
            "/api/auth/login", {"email": "founder@example.com", "password": PASSWORD}
        )
        assert half.status == 200, half.body
        assert half.body.get("user") is None
        assert (await device.get("/api/auth/sessions")).status == 401, "no session yet"

        step = half.body["twoStep"]
        finished = await device.post(
            "/api/auth/two-step",
            {"flowId": step["flowId"], "credential": key.get(step["options"])},
        )
        assert finished.status == 200, finished.body
        assert finished.body["user"]["id"] == founder.user_id
        sessions = (await device.get("/api/auth/sessions")).body["sessions"]
        assert next(row for row in sessions if row["current"])["method"] == "two_step"

    async def test_the_second_step_is_that_persons_passkey(self, founder: Client) -> None:
        await turn_on_two_step(founder)
        member = await invite_and_sign_up(founder, "Member")
        theirs = await add_passkey(member)
        half = await founder.fork().post(
            "/api/auth/login", {"email": "founder@example.com", "password": PASSWORD}
        )
        step = half.body["twoStep"]
        refused = await founder.fork().post(
            "/api/auth/two-step",
            {"flowId": step["flowId"], "credential": theirs.get(step["options"])},
        )
        assert refused.status == 400

    async def test_a_second_step_flow_is_not_a_sign_in_flow(self, founder: Client) -> None:
        key = await turn_on_two_step(founder)
        half = await founder.fork().post(
            "/api/auth/login", {"email": "founder@example.com", "password": PASSWORD}
        )
        step = half.body["twoStep"]
        crossed = await founder.fork().post(
            "/api/auth/passkey/sign-in",
            {"flowId": step["flowId"], "credential": key.get(step["options"])},
        )
        assert crossed.body["error"]["code"] == "passkey_refused"

    async def test_the_last_passkey_stays_while_it_is_asked_for(self, founder: Client) -> None:
        await turn_on_two_step(founder)
        passkey_id = (await founder.get("/api/auth/passkeys")).body["passkeys"][0]["id"]
        refused = await founder.delete(f"/api/auth/passkeys/{passkey_id}")
        assert refused.status == 400
        assert (await founder.put("/api/auth/two-step", {"on": False})).status == 200
        assert (await founder.delete(f"/api/auth/passkeys/{passkey_id}")).status == 200

    async def test_a_reset_proves_the_inbox_not_the_passkey(self, founder: Client) -> None:
        await turn_on_two_step(founder)
        from .test_account_security import _hashed

        async with transaction() as (session, _):
            await session.execute(
                text(
                    """
                    INSERT INTO password_resets (id, user_id, token_hash, expires_at)
                    VALUES (gen_random_uuid(), :user, :hash, now() + interval '1 hour')
                    """
                ),
                {"user": founder.user_id, "hash": _hashed("a-reset-token")},
            )
        device = founder.fork()
        reset = await device.post(
            "/api/auth/reset-password", {"token": "a-reset-token", "password": "a-new-password-1"}
        )
        assert reset.status == 200, reset.body
        assert reset.body["signedIn"] is False
        assert (await device.get("/api/auth/sessions")).status == 401

    @pytest.mark.parametrize("by", ["owner", "admin"])
    async def test_an_admin_can_end_it_for_somebody_who_lost_their_keys(
        self, founder: Client, by: str
    ) -> None:
        member = await invite_and_sign_up(founder, "Member")
        await turn_on_two_step(member)
        actor = founder if by == "owner" else await invite_and_sign_up(founder, "Admin", "admin")
        listed = (await actor.get("/api/admin/users")).body["users"]
        assert next(u for u in listed if u["id"] == member.user_id)["twoStep"] is True

        ended = await actor.post(f"/api/admin/users/{member.user_id}/two-step/end")
        assert ended.status == 200, ended.body
        signed_in = await member.fork().post(
            "/api/auth/login", {"email": "member@example.com", "password": PASSWORD}
        )
        assert signed_in.body["user"]["id"] == member.user_id
        assert ("two_step_off", None) in await kinds(member)
        async with SessionFactory() as session:
            audited = (
                await session.execute(
                    text("SELECT count(*) FROM audit_events WHERE action = 'user.two_step_ended'")
                )
            ).scalar()
        assert audited == 1

    async def test_an_admin_cannot_end_the_owners(self, founder: Client) -> None:
        await turn_on_two_step(founder)
        admin = await invite_and_sign_up(founder, "Admin", "admin")
        refused = await admin.post(f"/api/admin/users/{founder.user_id}/two-step/end")
        assert refused.status == 403
