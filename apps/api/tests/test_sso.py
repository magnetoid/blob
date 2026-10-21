"""Single sign-on with OpenID Connect (M3 · B1, ADR 0033).

Against `FakeIdP`, which does what a provider does with what Blob sends, so these walk
the protocol end to end: discovery, the state bound to the browser, PKCE, the client's
secret, the ID token's signature, issuer, audience, nonce and times — and then who that
is here, which is where 2026's OIDC takeovers happened.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.services import sso as sso_service

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up
from .oidc_fake import CLIENT_ID, CLIENT_SECRET, ISSUER, FakeIdP, person


@pytest.fixture
def idp(monkeypatch: pytest.MonkeyPatch) -> FakeIdP:
    provider = FakeIdP()
    import httpx

    monkeypatch.setattr(
        sso_service,
        "http_client",
        lambda: httpx.AsyncClient(transport=provider.transport(), follow_redirects=False),
    )
    sso_service.forget_cached()
    return provider


@pytest_asyncio.fixture
async def founder(client: Client) -> Client:
    return await sign_up(client, "Founder")


async def connect(
    admin: Client, *, slug: str = "acme", issuer: str = ISSUER, **overrides: Any
) -> dict[str, Any]:
    body = {
        "slug": slug,
        "name": "Acme SSO",
        "issuer": issuer,
        "clientId": CLIENT_ID,
        "clientSecret": CLIENT_SECRET,
        "allowedDomains": [],
        "linkByEmail": True,
        **overrides,
    }
    made = await admin.post("/api/admin/instance/sso", body)
    assert made.status == 201, made.body
    return dict(made.body)


async def round_trip(
    browser: Client,
    idp: FakeIdP,
    claims: dict[str, Any],
    *,
    intent: str = "sign_in",
    next_path: str | None = None,
    invite: str | None = None,
    carry_state: bool = True,
) -> Any:
    """Press the button, sign in at the provider, come back. Answers the callback."""
    begun = await browser.post(
        "/api/auth/sso/begin",
        {"provider": "acme", "intent": intent, "next": next_path, "invite": invite},
    )
    assert begun.status == 200, begun.body
    answer = idp.authorize(begun.body["url"], claims)
    arriving = browser if carry_state else browser.fork()
    return await arriving._http.get("/api/auth/sso/callback", params=answer)


def landed(response: Any) -> tuple[str, dict[str, str]]:
    assert response.status_code == 303, response.text
    location = urlparse(response.headers["location"])
    return location.path, {key: values[0] for key, values in parse_qs(location.query).items()}


async def method_of_current(browser: Client) -> str | None:
    sessions = (await browser.get("/api/auth/sessions")).body["sessions"]
    return next(row["method"] for row in sessions if row["current"])


# ─── setting it up ────────────────────────────────────────────────────────────


class TestTheAdministrator:
    async def test_a_provider_is_connected_and_offered(self, founder: Client, idp: FakeIdP) -> None:
        made = await connect(founder, issuer=ISSUER + "/")  # typed with a trailing slash
        assert made["issuer"] == ISSUER  # as the provider writes it
        assert made["hasSecret"] is True
        assert "clientSecret" not in made
        state = (await founder.fork().get("/api/auth/state")).body
        assert state["providers"] == [{"slug": "acme", "name": "Acme SSO"}]
        listed = (await founder.get("/api/admin/instance/sso")).body
        assert listed["callbackUrl"].endswith("/api/auth/sso/callback")

    async def test_only_the_servers_administrator_may(self, founder: Client, idp: FakeIdP) -> None:
        admin = await invite_and_sign_up(founder, "Admin", "admin")
        refused = await admin.post(
            "/api/admin/instance/sso",
            {"slug": "acme", "name": "x", "issuer": ISSUER, "clientId": CLIENT_ID},
        )
        assert refused.status == 403

    async def test_it_needs_a_fresh_sign_in(self, founder: Client, idp: FakeIdP) -> None:
        async with transaction() as (session, _):
            await session.execute(text("UPDATE sessions SET reauth_at = now() - interval '1 hour'"))
        refused = await founder.post(
            "/api/admin/instance/sso",
            {"slug": "acme", "name": "x", "issuer": ISSUER, "clientId": CLIENT_ID},
        )
        assert refused.body["error"]["code"] == "reauth_required"

    async def test_an_issuer_that_names_another_is_refused(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        idp.issuer = "https://someone-else.example.com"
        refused = await founder.post(
            "/api/admin/instance/sso",
            {"slug": "acme", "name": "x", "issuer": ISSUER, "clientId": CLIENT_ID},
        )
        assert refused.status == 400
        assert refused.body["error"]["code"] == "sso_issuer_mismatch"

    async def test_a_disabled_provider_is_not_offered(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder, enabled=False)
        assert (await founder.fork().get("/api/auth/state")).body["providers"] == []


# ─── signing in ───────────────────────────────────────────────────────────────


class TestSigningIn:
    async def test_a_verified_address_signs_into_its_account(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        browser = founder.fork()
        path, query = landed(await round_trip(browser, idp, person("sub-1", "founder@example.com")))
        assert (path, query) == ("/", {})
        assert await method_of_current(browser) == "sso"
        # The client authenticated with its secret at the token endpoint.
        assert idp.token_requests[-1].headers["authorization"].startswith("Basic ")
        events = [
            (e["kind"], e["method"])
            for e in (await browser.get("/api/auth/activity")).body["events"]
        ]
        assert ("signed_in", "sso") in events and ("sso_linked", "sso") in events

    async def test_the_subject_decides_once_it_is_known(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        # The provider now says another address — renamed, or an email claim edited by
        # its user. Still the same person here: the pair (provider, sub) is who it is.
        browser = founder.fork()
        landed(await round_trip(browser, idp, person("sub-1", "somebody.else@example.com")))
        me = (await browser.get("/api/bootstrap")).body["user"]
        assert me["id"] == founder.user_id

    @pytest.mark.parametrize("verified", [None, "true", 1, False])
    async def test_only_a_verified_address_is_vouched_for(
        self, founder: Client, idp: FakeIdP, verified: Any
    ) -> None:
        await connect(founder)
        claims = person("sub-1", "founder@example.com", verified=verified)
        _path, query = landed(await round_trip(founder.fork(), idp, claims))
        assert query == {"sso_error": "email_unverified"}

    async def test_a_provider_told_not_to_link_by_address_does_not(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder, linkByEmail=False)
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        )
        assert query == {"sso_error": "not_linked"}

    async def test_only_the_allowed_domains(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder, allowedDomains=["acme.example"])
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        )
        assert query == {"sso_error": "domain"}

    async def test_an_address_already_linked_to_another_subject_is_refused(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        """CVE-2026-55075's shape: a second identity at the same provider asserting the
        address of somebody already linked there."""
        await connect(founder)
        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-2", "founder@example.com"))
        )
        assert query == {"sso_error": "linked_elsewhere"}

    async def test_nobody_new_gets_in_without_a_way_in(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        _, query = landed(await round_trip(founder.fork(), idp, person("sub-9", "new@example.com")))
        assert query["sso_error"] == "no_account"

    async def test_a_providers_workspace_takes_new_people_as_members(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        await connect(founder, joinWorkspaceId=workspace, allowedDomains=["example.com"])
        browser = founder.fork()
        landed(await round_trip(browser, idp, person("sub-9", "new@example.com", name="Founder")))
        me = (await browser.get("/api/bootstrap")).body["user"]
        assert me["role"] == "member"
        assert me["displayName"] == "Founder 2"  # nobody chose it, so it is made unique
        async with SessionFactory() as session:
            hash_ = (
                await session.execute(
                    text("SELECT password_hash FROM users WHERE email = 'new@example.com'")
                )
            ).scalar()
        assert hash_ is None

    async def test_letting_new_people_in_needs_the_domains_named(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        """With no domain named, a provider like Google would let in anyone with a free
        account — the hole the live check found."""
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        refused = await founder.post(
            "/api/admin/instance/sso",
            {
                "slug": "acme",
                "name": "Acme",
                "issuer": ISSUER,
                "clientId": CLIENT_ID,
                "joinWorkspaceId": workspace,
                "allowedDomains": [],
            },
        )
        assert refused.status == 400
        assert refused.body["error"]["code"] == "sso_domains_required"

    async def test_a_stranger_from_another_domain_stays_out(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        await connect(founder, joinWorkspaceId=workspace, allowedDomains=["example.com"])
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-x", "stranger@elsewhere.example"))
        )
        assert query == {"sso_error": "domain"}

    async def test_a_provider_saved_without_domains_lets_nobody_new_in(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        made = await connect(founder)
        async with transaction() as (session, _):
            await session.execute(
                text("UPDATE sso_providers SET join_workspace_id = :ws WHERE id = :id"),
                {"ws": workspace, "id": made["id"]},
            )
        _, query = landed(await round_trip(founder.fork(), idp, person("sub-x", "new@example.com")))
        assert query == {"sso_error": "no_account"}

    async def test_an_invitation_is_a_way_in(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        invite = await founder.post("/api/invites", {"email": "new@example.com"})
        token = invite.body["url"].split("/join/")[1]
        browser = founder.fork()
        landed(await round_trip(browser, idp, person("sub-9", "new@example.com"), invite=token))
        assert (await browser.get("/api/bootstrap")).status == 200
        # Spent: the same link does not let a second person in.
        _, query = landed(
            await round_trip(
                founder.fork(), idp, person("sub-8", "other@example.com"), invite=token
            )
        )
        assert query == {"sso_error": "invite_expired"}

    async def test_an_invitation_for_another_address_is_not_one(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        invite = await founder.post("/api/invites", {"email": "named@example.com"})
        token = invite.body["url"].split("/join/")[1]
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-9", "else@example.com"), invite=token)
        )
        assert query == {"sso_error": "invite_wrong_address"}

    async def test_a_deactivated_account_stays_out(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        member = await invite_and_sign_up(founder, "Member")
        await founder.post(f"/api/admin/users/{member.user_id}/deactivate")
        _, query = landed(
            await round_trip(member.fork(), idp, person("sub-5", "member@example.com"))
        )
        assert query == {"sso_error": "deactivated"}

    async def test_where_it_lands_is_a_path_here(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        for asked, expected in [
            ("/settings/security", "/settings/security"),
            ("//evil.example/x", "/"),
            ("https://evil.example/", "/"),
        ]:
            path, _ = landed(
                await round_trip(
                    founder.fork(), idp, person("sub-1", "founder@example.com"), next_path=asked
                )
            )
            assert path == expected


# ─── the round trip itself ────────────────────────────────────────────────────


class TestTheRoundTrip:
    async def test_it_finishes_only_in_the_browser_that_began_it(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        """Login CSRF: an attacker's own sign-in, finished in the victim's browser."""
        await connect(founder)
        response = await round_trip(
            founder.fork(), idp, person("sub-1", "founder@example.com"), carry_state=False
        )
        _, query = landed(response)
        assert query == {"sso_error": "expired"}

    async def test_an_answer_is_used_once(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        browser = founder.fork()
        begun = await browser.post("/api/auth/sso/begin", {"provider": "acme"})
        answer = idp.authorize(begun.body["url"], person("sub-1", "founder@example.com"))
        first = await browser._http.get("/api/auth/sso/callback", params=answer)
        assert landed(first)[1] == {}
        again = await browser._http.get("/api/auth/sso/callback", params=answer)
        assert landed(again)[1] == {"sso_error": "expired"}

    async def test_saying_no_at_the_provider(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        browser = founder.fork()
        begun = await browser.post("/api/auth/sso/begin", {"provider": "acme"})
        state = parse_qs(urlparse(begun.body["url"]).query)["state"][0]
        refused = await browser._http.get(
            "/api/auth/sso/callback", params={"state": state, "error": "access_denied"}
        )
        assert landed(refused)[1] == {"sso_error": "denied"}

    @pytest.mark.parametrize(
        "tamper",
        [
            {"nonce": "another-sign-in"},
            {"aud": "another-client"},
            {"iss": "https://someone-else.example.com"},
            {"exp": 1_000_000_000},
            {"azp": "another-client"},
        ],
        ids=["nonce", "audience", "issuer", "expired", "authorized-party"],
    )
    async def test_a_token_that_does_not_check_out_is_refused(
        self, founder: Client, idp: FakeIdP, tamper: dict[str, Any]
    ) -> None:
        await connect(founder)
        idp.tamper = tamper
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        )
        assert query == {"sso_error": "invalid_token"}

    async def test_a_symmetric_signature_is_refused(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        idp.algorithm = "HS256"
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        )
        assert query == {"sso_error": "invalid_token"}

    async def test_the_answer_must_say_it_came_from_the_issuer(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        browser = founder.fork()
        begun = await browser.post("/api/auth/sso/begin", {"provider": "acme"})
        answer = idp.authorize(begun.body["url"], person("sub-1", "founder@example.com"))
        answer["iss"] = "https://someone-else.example.com"
        refused = await browser._http.get("/api/auth/sso/callback", params=answer)
        assert landed(refused)[1] == {"sso_error": "invalid_token"}

    async def test_a_rotated_key_is_fetched_again(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        landed(await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com")))
        idp.rotate()
        _, query = landed(
            await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        )
        assert query == {}


# ─── confirming, linking, unlinking ───────────────────────────────────────────


async def go_stale() -> None:
    async with transaction() as (session, _):
        await session.execute(text("UPDATE sessions SET reauth_at = now() - interval '1 hour'"))


class TestYours:
    async def test_the_provider_confirms_it_is_you(self, founder: Client, idp: FakeIdP) -> None:
        await connect(founder)
        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        await go_stale()
        assert (await founder.post("/api/me/mcp-tokens", {"name": "x"})).status == 403
        state = (await founder.get("/api/auth/reauth")).body
        assert "sso" in state["methods"]
        assert state["providers"] == [{"slug": "acme", "name": "Acme SSO"}]

        page = await round_trip(
            founder, idp, person("sub-1", "founder@example.com"), intent="confirm"
        )
        assert page.status_code == 200, page.text
        assert "That's you" in page.text
        assert idp.codes == {}  # spent
        assert (await founder.post("/api/me/mcp-tokens", {"name": "x"})).status == 200

    async def test_a_confirmation_needs_a_fresh_sign_in_at_the_provider(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        await go_stale()
        idp.tamper = {"auth_time": 1_000_000_000}
        page = await round_trip(
            founder, idp, person("sub-1", "founder@example.com"), intent="confirm"
        )
        assert page.status_code == 303  # refused, back to the sign-in page's sentence
        assert (await founder.post("/api/me/mcp-tokens", {"name": "x"})).status == 403

    async def test_somebody_elses_provider_account_confirms_nothing(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder)
        member = await invite_and_sign_up(founder, "Member")
        await round_trip(member.fork(), idp, person("sub-m", "member@example.com"))
        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        await go_stale()
        page = await round_trip(
            founder, idp, person("sub-m", "member@example.com"), intent="confirm"
        )
        assert page.status_code == 400
        assert (await founder.post("/api/me/mcp-tokens", {"name": "x"})).status == 403

    async def test_linking_needs_a_fresh_sign_in_and_takes_any_address(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        await connect(founder, linkByEmail=False)
        await go_stale()
        refused = await founder.post("/api/auth/sso/begin", {"provider": "acme", "intent": "link"})
        assert refused.body["error"]["code"] == "reauth_required"
        await founder.post("/api/auth/reauth", {"password": PASSWORD})

        path, query = landed(
            await round_trip(founder, idp, person("sub-w", "f.work@corp.example"), intent="link")
        )
        assert (path, query) == ("/settings/security", {"sso": "linked"})
        listed = (await founder.get("/api/auth/sso/identities")).body
        assert [i["slug"] for i in listed["identities"]] == ["acme"]
        browser = founder.fork()
        landed(await round_trip(browser, idp, person("sub-w", "f.work@corp.example")))
        assert (await browser.get("/api/bootstrap")).body["user"]["id"] == founder.user_id

    async def test_unlinking_keeps_a_way_in(self, founder: Client, idp: FakeIdP) -> None:
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        made = await connect(founder, joinWorkspaceId=workspace, allowedDomains=["example.com"])
        newcomer = founder.fork()
        landed(await round_trip(newcomer, idp, person("sub-n", "new@example.com")))
        refused = await newcomer.delete(f"/api/auth/sso/identities/{made['id']}")
        assert refused.status == 400
        assert refused.body["error"]["code"] == "last_way_in"

        await round_trip(founder.fork(), idp, person("sub-1", "founder@example.com"))
        unlinked = await founder.delete(f"/api/auth/sso/identities/{made['id']}")
        assert unlinked.status == 200

    async def test_a_password_cannot_be_set_on_an_address_that_has_none(
        self, founder: Client, idp: FakeIdP
    ) -> None:
        """An open invitation link must not let anyone give a password-less person one."""
        workspace = (await founder.get("/api/bootstrap")).body["workspace"]["id"]
        await connect(founder, joinWorkspaceId=workspace, allowedDomains=["example.com"])
        landed(await round_trip(founder.fork(), idp, person("sub-n", "new@example.com")))
        second = await founder.post("/api/admin/instance/workspaces", {"name": "Second"})
        await founder.post(f"/api/workspaces/{second.body['id']}/switch")
        invite = await founder.post("/api/invites", {})
        token = invite.body["url"].split("/join/")[1]
        refused = await founder.fork().post(
            "/api/auth/signup",
            {
                "email": "new@example.com",
                "password": "an-attackers-password",
                "displayName": "New",
                "inviteToken": token,
            },
        )
        assert refused.status == 400
