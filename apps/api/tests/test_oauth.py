"""Blob as the authorization server for its own MCP endpoint (ADR 0029).

An assistant given only the endpoint's URL must be able to find its way to a sign-in,
and nothing it does on the way may let it act as anyone who did not say yes — or do more
than they said yes to. The flow tests walk it the way Claude and ChatGPT do: a 401 with
directions, the two metadata documents, a client registration, the person's answer, a
code traded with its PKCE verifier, and a refresh chain that ends the moment it is
replayed.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.lib.auth import hash_token
from blob_api.main import app
from blob_api.services import oauth as oauth_service

from .helpers import Client, invite_and_sign_up, sign_up

HOSTED = "https://claude.example.com/api/mcp/auth_callback"
LOOPBACK = "http://127.0.0.1/callback"
CIMD = "https://claude.example.com/oauth/client.json"


def resource() -> str:
    return oauth_service.resource()


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@pytest_asyncio.fixture
async def outside() -> AsyncIterator[httpx.AsyncClient]:
    """The assistant's own server: no cookie, nothing of the person's."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    return {"owner": owner, "member": member}


async def register(outside: httpx.AsyncClient, redirect: str = HOSTED, name: str = "Claude") -> str:
    made = await outside.post(
        "/oauth/register", json={"client_name": name, "redirect_uris": [redirect]}
    )
    assert made.status_code == 201, made.text
    assert made.json()["token_endpoint_auth_method"] == "none"
    return str(made.json()["client_id"])


def query(client_id: str, challenge: str, **overrides: str | None) -> str:
    params: dict[str, str | None] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": HOSTED,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "the-clients-own-state",
        "scope": "read write",
        "resource": resource(),
    }
    params.update(overrides)
    return urlencode({key: value for key, value in params.items() if value is not None})


async def ask(person: Client, q: str) -> Any:
    return await person.post("/api/oauth/authorize", {"query": q})


def answered(url: str) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(urlparse(url).query).items()}


async def code_for(
    person: Client, client_id: str, challenge: str, *, write: bool = False, **overrides: str
) -> str:
    asked = await ask(person, query(client_id, challenge, **overrides))
    assert asked.status == 200, asked.body
    request = asked.body["request"]
    said = await person.post(
        f"/api/oauth/requests/{request['id']}", {"approve": True, "write": write}
    )
    assert said.status == 200, said.body
    reply = answered(said.body["redirectTo"])
    assert reply["state"] == "the-clients-own-state"
    assert reply["iss"] == oauth_service.issuer()
    return reply["code"]


async def trade(
    outside: httpx.AsyncClient, client_id: str, code: str, verifier: str, **extra: str
) -> httpx.Response:
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": HOSTED,
        "code_verifier": verifier,
        "resource": resource(),
        **extra,
    }
    return await outside.post("/oauth/token", data=form)


async def connect(
    outside: httpx.AsyncClient, person: Client, *, write: bool = False
) -> tuple[str, dict[str, Any]]:
    client_id = await register(outside)
    verifier, challenge = pkce()
    code = await code_for(person, client_id, challenge, write=write)
    issued = await trade(outside, client_id, code, verifier)
    assert issued.status_code == 200, issued.text
    assert issued.headers["cache-control"] == "no-store"
    return client_id, issued.json()


async def tools(outside: httpx.AsyncClient, token: str) -> httpx.Response:
    return await outside.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        headers={"authorization": f"Bearer {token}", "mcp-protocol-version": "2025-06-18"},
    )


def names(listed: httpx.Response) -> set[str]:
    return {tool["name"] for tool in listed.json()["result"]["tools"]}


# ─── finding the way in ──────────────────────────────────────────────────────────────


class TestDiscovery:
    async def test_a_401_says_where_to_sign_in(self, outside: httpx.AsyncClient) -> None:
        bare = await outside.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert bare.status_code == 401
        challenge = bare.headers["www-authenticate"]
        assert challenge.startswith("Bearer ")
        assert f'resource_metadata="{oauth_service.resource_metadata_url()}"' in challenge
        assert 'scope="read write"' in challenge
        assert "invalid_token" not in challenge

        wrong = await outside.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"authorization": "Bearer not-a-token"},
        )
        assert wrong.status_code == 401
        assert 'error="invalid_token"' in wrong.headers["www-authenticate"]

    async def test_the_metadata_names_this_server_for_this_endpoint(
        self, outside: httpx.AsyncClient
    ) -> None:
        for path in (
            "/.well-known/oauth-protected-resource/api/mcp",
            "/.well-known/oauth-protected-resource",
        ):
            found = await outside.get(path)
            assert found.status_code == 200, path
            assert found.json()["resource"] == resource()
            assert found.json()["authorization_servers"] == [oauth_service.issuer()]

        server = (await outside.get("/.well-known/oauth-authorization-server")).json()
        assert server["issuer"] == oauth_service.issuer()
        assert server["code_challenge_methods_supported"] == ["S256"]
        assert server["client_id_metadata_document_supported"] is True
        assert server["authorization_response_iss_parameter_supported"] is True
        assert server["token_endpoint_auth_methods_supported"] == ["none"]
        assert server["authorization_endpoint"].endswith("/oauth/authorize")

    async def test_the_token_endpoint_takes_no_origin_check(
        self, outside: httpx.AsyncClient
    ) -> None:
        """No cookie is read there, so another origin borrows nothing — and an assistant
        that runs in a browser sends its own."""
        answer = await outside.post(
            "/oauth/token",
            data={"grant_type": "authorization_code", "code": "nope"},
            headers={"origin": "https://claude.example.com"},
        )
        assert answer.status_code == 400
        assert answer.json()["error"] == "invalid_grant"
        assert answer.headers["access-control-allow-origin"] == "*"


# ─── the person's answer ─────────────────────────────────────────────────────────────


class TestConsent:
    async def test_the_question_names_the_app_and_where_the_answer_goes(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside, name="  Claude\n  ")
        _, challenge = pkce()
        asked = await ask(team["member"], query(client_id, challenge))
        assert asked.status == 200, asked.body
        request = asked.body["request"]
        assert request["clientName"] == "Claude"
        # Registered, so only its own word: no domain vouches for it.
        assert request["vouchedBy"] is None
        assert request["redirectHost"] == "claude.example.com"
        assert request["local"] is False
        assert request["scopes"] == ["read", "write"]

    async def test_read_unless_the_person_ticks_write(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, issued = await connect(outside, team["member"])
        assert issued["scope"] == "read"
        listed = await tools(outside, issued["access_token"])
        assert listed.status_code == 200, listed.text
        assert "read_channel" in names(listed)
        assert "post_message" not in names(listed)

        _, writer = await connect(outside, team["member"], write=True)
        assert writer["scope"] == "read write"
        assert "post_message" in names(await tools(outside, writer["access_token"]))

    async def test_no_is_sent_back_as_access_denied(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside)
        _, challenge = pkce()
        request = (await ask(team["member"], query(client_id, challenge))).body["request"]
        said = await team["member"].post(f"/api/oauth/requests/{request['id']}", {"approve": False})
        reply = answered(said.body["redirectTo"])
        assert reply["error"] == "access_denied"
        assert reply["state"] == "the-clients-own-state"
        assert "code" not in reply
        async with SessionFactory() as session:
            assert (await session.execute(text("SELECT count(*) FROM oauth_grants"))).scalar() == 0

    async def test_only_the_person_asked_may_answer_and_only_once(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside)
        _, challenge = pkce()
        request = (await ask(team["member"], query(client_id, challenge))).body["request"]
        stolen = await team["owner"].post(
            f"/api/oauth/requests/{request['id']}", {"approve": True, "write": True}
        )
        assert stolen.status == 400
        assert stolen.body["error"]["code"] == "oauth_request_invalid"

        # Somebody else's attempt does not spend it; its person's answer does.
        first = await team["member"].post(f"/api/oauth/requests/{request['id']}", {"approve": True})
        assert first.status == 200, first.body
        twice = await team["member"].post(f"/api/oauth/requests/{request['id']}", {"approve": True})
        assert twice.status == 400

    async def test_an_untrusted_client_or_redirect_is_said_to_the_person_not_redirected(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, challenge = pkce()
        unknown = await ask(team["member"], query("no-such-client", challenge))
        assert unknown.status == 400
        assert unknown.body["error"]["code"] == "oauth_request_invalid"

        client_id = await register(outside)
        elsewhere = await ask(
            team["member"],
            query(client_id, challenge, redirect_uri="https://attacker.example.net/cb"),
        )
        assert elsewhere.status == 400
        assert "redirectTo" not in elsewhere.body

    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"code_challenge_method": "plain"}, "invalid_request"),
            ({"code_challenge": None}, "invalid_request"),
            ({"response_type": "token"}, "unsupported_response_type"),
            ({"resource": "https://elsewhere.example.com/mcp"}, "invalid_target"),
        ],
    )
    async def test_a_bad_request_from_a_good_client_goes_back_to_it(
        self,
        outside: httpx.AsyncClient,
        team: dict[str, Any],
        overrides: dict[str, str | None],
        error: str,
    ) -> None:
        client_id = await register(outside)
        _, challenge = pkce()
        asked = await ask(team["member"], query(client_id, challenge, **overrides))
        assert asked.status == 200, asked.body
        reply = answered(asked.body["redirectTo"])
        assert reply["error"] == error
        assert reply["state"] == "the-clients-own-state"
        assert reply["iss"] == oauth_service.issuer()

    async def test_a_parameter_given_twice_is_refused(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside)
        _, challenge = pkce()
        doubled = query(client_id, challenge) + "&scope=read"
        asked = await ask(team["member"], doubled)
        assert asked.status == 400


# ─── trading a code, and refreshing ──────────────────────────────────────────────────


class TestTokens:
    async def test_a_code_is_good_once_and_only_with_its_verifier(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside)
        verifier, challenge = pkce()
        code = await code_for(team["member"], client_id, challenge)

        wrong = await trade(outside, client_id, code, pkce()[0])
        assert wrong.status_code == 400
        assert wrong.json()["error"] == "invalid_grant"
        # A wrong verifier spends the code too: a guess gets one try.
        again = await trade(outside, client_id, code, verifier)
        assert again.json()["error"] == "invalid_grant"

        code = await code_for(team["member"], client_id, challenge)
        other_client = await register(outside, name="Other")
        stolen = await trade(outside, other_client, code, verifier)
        assert stolen.json()["error"] == "invalid_grant"

        code = await code_for(team["member"], client_id, challenge)
        moved = await trade(
            outside, client_id, code, verifier, redirect_uri="https://x.example.com/"
        )
        assert moved.json()["error"] == "invalid_grant"

        code = await code_for(team["member"], client_id, challenge)
        good = await trade(outside, client_id, code, verifier)
        assert good.status_code == 200, good.text
        replay = await trade(outside, client_id, code, verifier)
        assert replay.json()["error"] == "invalid_grant"

    async def test_the_token_is_the_person_and_lasts_an_hour(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, issued = await connect(outside, team["member"])
        assert issued["token_type"] == "Bearer"
        assert issued["expires_in"] == 3600
        whoami = await outside.post(
            "/api/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "whoami", "arguments": {}},
            },
            headers={
                "authorization": f"Bearer {issued['access_token']}",
                "mcp-protocol-version": "2025-06-18",
            },
        )
        assert "Member" in whoami.json()["result"]["content"][0]["text"]

    async def test_a_refresh_rotates_and_a_replay_ends_the_connection(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id, issued = await connect(outside, team["member"], write=True)
        fresh = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        assert fresh.status_code == 200, fresh.text
        renewed = fresh.json()
        assert renewed["refresh_token"] != issued["refresh_token"]
        assert renewed["scope"] == "read write"
        assert (await tools(outside, renewed["access_token"])).status_code == 200

        replayed = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        assert replayed.json()["error"] == "invalid_grant"
        # Whoever held the newer link is out too: the chain was stolen, or the thief
        # came second, and either way nobody can tell which is which.
        assert (await tools(outside, renewed["access_token"])).status_code == 401
        after = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": renewed["refresh_token"],
                "client_id": client_id,
            },
        )
        assert after.json()["error"] == "invalid_grant"

    async def test_a_refresh_may_narrow_but_never_widen(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id, issued = await connect(outside, team["member"])
        wider = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
                "scope": "read write",
            },
        )
        assert wider.json()["error"] == "invalid_scope"

    async def test_a_deactivated_person_is_nobody_s_connection(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id, issued = await connect(outside, team["member"])
        async with SessionFactory() as session:
            await session.execute(
                text("UPDATE users SET deactivated_at = now() WHERE id = :id"),
                {"id": team["member"].user_id},
            )
            await session.commit()
        assert (await tools(outside, issued["access_token"])).status_code == 401
        refused = await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        assert refused.json()["error"] == "invalid_grant"

    async def test_revoking_a_refresh_token_ends_the_connection(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, issued = await connect(outside, team["member"])
        gone = await outside.post("/oauth/revoke", data={"token": issued["refresh_token"]})
        assert gone.status_code == 200
        assert (await tools(outside, issued["access_token"])).status_code == 401
        # Anything else is answered the same, as RFC 7009 asks.
        unknown = await outside.post("/oauth/revoke", data={"token": "never-issued"})
        assert unknown.status_code == 200

    async def test_a_client_id_sent_by_basic_auth_is_understood(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        """Some clients authenticate with HTTP Basic though they registered as public;
        the id is what counts, and two different ids are refused."""
        client_id = await register(outside)
        verifier, challenge = pkce()
        code = await code_for(team["member"], client_id, challenge)
        basic = base64.b64encode(f"{client_id}:ignored".encode()).decode()
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": HOSTED,
            "code_verifier": verifier,
        }
        clash = await outside.post(
            "/oauth/token",
            data={**form, "client_id": "someone-else"},
            headers={"authorization": f"Basic {basic}"},
        )
        assert clash.json()["error"] == "invalid_request"
        issued = await outside.post(
            "/oauth/token", data=form, headers={"authorization": f"Basic {basic}"}
        )
        assert issued.status_code == 200, issued.text

    async def test_unknown_grant_types_are_refused_in_the_oauth_shape(
        self, outside: httpx.AsyncClient
    ) -> None:
        refused = await outside.post("/oauth/token", data={"grant_type": "password"})
        assert refused.status_code == 400
        assert refused.json() == {
            "error": "unsupported_grant_type",
            "error_description": "authorization_code or refresh_token.",
        }


# ─── registration, and clients that vouch for themselves ─────────────────────────────


class TestClients:
    @pytest.mark.parametrize(
        "redirect",
        ["http://claude.example.com/cb", "https://claude.example.com/cb#frag", "not a url"],
    )
    async def test_registration_takes_only_safe_redirects(
        self, outside: httpx.AsyncClient, redirect: str
    ) -> None:
        refused = await outside.post(
            "/oauth/register", json={"client_name": "X", "redirect_uris": [redirect]}
        )
        assert refused.status_code == 400
        assert refused.json()["error"] == "invalid_redirect_uri"

    def test_a_loopback_redirect_matches_on_any_port(self) -> None:
        registered = [LOOPBACK]
        assert oauth_service.redirect_matches(registered, "http://127.0.0.1:53124/callback")
        assert not oauth_service.redirect_matches(registered, "http://127.0.0.1:53124/other")
        assert not oauth_service.redirect_matches(registered, "http://localhost:53124/callback")
        assert not oauth_service.redirect_matches([HOSTED], HOSTED + "/")

    async def test_a_command_line_assistant_is_said_to_be_local(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id = await register(outside, redirect=LOOPBACK, name="Claude Code")
        verifier, challenge = pkce()
        port = "http://127.0.0.1:61000/callback"
        asked = await ask(team["member"], query(client_id, challenge, redirect_uri=port))
        assert asked.body["request"]["local"] is True
        said = await team["member"].post(
            f"/api/oauth/requests/{asked.body['request']['id']}", {"approve": True}
        )
        assert said.body["redirectTo"].startswith(port + "?")
        issued = await trade(
            outside,
            client_id,
            answered(said.body["redirectTo"])["code"],
            verifier,
            redirect_uri=port,
        )
        assert issued.status_code == 200, issued.text

    @pytest.fixture
    def metadata_host(self, monkeypatch: pytest.MonkeyPatch) -> list[str]:
        fetched: list[str] = []
        document: dict[str, Any] = {
            "client_id": CIMD,
            "client_name": "Claude",
            "redirect_uris": [HOSTED],
        }

        def handler(request: httpx.Request) -> httpx.Response:
            fetched.append(str(request.url))
            if str(request.url) == CIMD:
                return httpx.Response(200, json=document)
            if str(request.url) == "https://liar.example.com/client.json":
                return httpx.Response(200, json={**document, "client_id": CIMD})
            return httpx.Response(404)

        monkeypatch.setattr(
            oauth_service,
            "open_client",
            lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        real = net.is_private_host

        async def public(hostname: str) -> bool:
            return False if hostname.endswith("example.com") else await real(hostname)

        monkeypatch.setattr(net, "is_private_host", public)
        return fetched

    async def test_a_metadata_document_names_who_vouches_and_is_read_once_a_day(
        self, metadata_host: list[str], outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        verifier, challenge = pkce()
        asked = await ask(team["member"], query(CIMD, challenge))
        assert asked.status == 200, asked.body
        assert asked.body["request"]["vouchedBy"] == "claude.example.com"
        assert asked.body["request"]["clientName"] == "Claude"

        again = await ask(team["member"], query(CIMD, challenge))
        assert again.status == 200
        assert metadata_host == [CIMD], "a fresh document is not fetched again"

        said = await team["member"].post(
            f"/api/oauth/requests/{again.body['request']['id']}", {"approve": True}
        )
        code = answered(said.body["redirectTo"])["code"]
        issued = await trade(outside, CIMD, code, verifier)
        assert issued.status_code == 200, issued.text

    async def test_a_document_that_does_not_name_itself_is_refused(
        self, metadata_host: list[str], team: dict[str, Any]
    ) -> None:
        _, challenge = pkce()
        liar = await ask(team["member"], query("https://liar.example.com/client.json", challenge))
        assert liar.status == 400
        assert "name itself" in liar.body["error"]["message"]

    async def test_a_document_inside_the_network_is_never_fetched(
        self, metadata_host: list[str], team: dict[str, Any]
    ) -> None:
        _, challenge = pkce()
        inside = await ask(team["member"], query("https://127.0.0.1/client.json", challenge))
        assert inside.status == 400
        assert metadata_host == []


# ─── what people and admins see ──────────────────────────────────────────────────────


class TestConnectedApps:
    async def test_a_connection_is_listed_once_not_once_per_token(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id, issued = await connect(outside, team["member"])
        await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        mine = await team["member"].get("/api/oauth/grants")
        assert mine.status == 200, mine.body
        assert [grant["clientName"] for grant in mine.body["grants"]] == ["Claude"]
        assert mine.body["url"] == resource()
        assert (await team["member"].get("/api/me/mcp-tokens")).body["tokens"] == []
        assert (await team["owner"].get("/api/admin/mcp-tokens")).body["tokens"] == []

        # Saying yes to the same app again is the same connection, not a second one…
        _, challenge = pkce()
        await code_for(team["member"], client_id, challenge, write=True)
        mine = await team["member"].get("/api/oauth/grants")
        assert len(mine.body["grants"]) == 1
        assert mine.body["grants"][0]["scopes"] == ["read", "write"]
        # …while an app that registered again is, as far as anyone can tell, another app.
        await connect(outside, team["member"])
        assert len((await team["member"].get("/api/oauth/grants")).body["grants"]) == 2

    async def test_disconnecting_ends_every_token_it_minted(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, issued = await connect(outside, team["member"])
        grant = (await team["member"].get("/api/oauth/grants")).body["grants"][0]
        # Not somebody else's to end.
        assert (await team["owner"].delete(f"/api/oauth/grants/{grant['id']}")).status == 404
        gone = await team["member"].delete(f"/api/oauth/grants/{grant['id']}")
        assert gone.status == 200, gone.body
        assert (await tools(outside, issued["access_token"])).status_code == 401
        assert (await team["member"].get("/api/oauth/grants")).body["grants"] == []

    async def test_an_admin_sees_and_ends_anyone_s(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        _, issued = await connect(outside, team["member"])
        assert (await team["member"].get("/api/admin/oauth-grants")).status == 403
        listed = await team["owner"].get("/api/admin/oauth-grants")
        assert listed.status == 200, listed.body
        grant = listed.body["grants"][0]
        assert grant["ownerName"] == "Member"
        assert grant["clientName"] == "Claude"
        assert (await team["owner"].delete(f"/api/admin/oauth-grants/{grant['id']}")).status == 200
        assert (await tools(outside, issued["access_token"])).status_code == 401
        async with SessionFactory() as session:
            actions = (
                (
                    await session.execute(
                        text(
                            "SELECT action FROM audit_events WHERE action LIKE 'oauth.%' ORDER BY 1"
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert actions == ["oauth.granted", "oauth.revoked"]

    async def test_the_sweep_keeps_what_is_live(
        self, outside: httpx.AsyncClient, team: dict[str, Any]
    ) -> None:
        client_id, issued = await connect(outside, team["member"])
        await outside.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": issued["refresh_token"],
                "client_id": client_id,
            },
        )
        async with SessionFactory() as session:
            await session.execute(
                text(
                    "UPDATE oauth_refresh_tokens SET used_at = now() - interval '2 days'"
                    " WHERE used_at IS NOT NULL"
                )
            )
            await session.execute(
                text(
                    "UPDATE mcp_tokens SET expires_at = now() - interval '2 days'"
                    " WHERE token_hash = :hash"
                ),
                {"hash": hash_token(issued["access_token"])},
            )
            # And a client that registered a month ago and was never connected.
            await session.execute(
                text(
                    "INSERT INTO oauth_clients (id, client_id, kind, client_name, redirect_uris,"
                    " created_at) VALUES (gen_random_uuid(), 'abandoned', 'registered', 'Old',"
                    " ARRAY['https://old.example.com/cb'], now() - interval '31 days')"
                )
            )
            await session.execute(
                text("UPDATE oauth_clients SET created_at = now() - interval '31 days'")
            )
            swept = await oauth_service.sweep(session)
            await session.commit()
            left = (
                await session.execute(
                    text(
                        "SELECT (SELECT count(*) FROM mcp_tokens),"
                        " (SELECT count(*) FROM oauth_refresh_tokens)"
                    )
                )
            ).one()
        # The used link, the expired token and the abandoned client — not the client
        # that is still connected, however old it is.
        assert swept == 3
        assert tuple(left) == (1, 1)
        async with SessionFactory() as session:
            kept = (await session.execute(text("SELECT client_name FROM oauth_clients"))).scalars()
            assert list(kept) == ["Claude"]


async def test_the_metadata_is_json_not_the_app(tmp_path: Any) -> None:
    """A probe for a document this server does not publish hears 404 — not index.html
    with a 200, which a client would try to parse as JSON. The consent page is the
    client's, so `/oauth/authorize` is still the app."""
    from starlette.applications import Starlette
    from starlette.routing import Mount

    from blob_api.web import SinglePageApp

    (tmp_path / "index.html").write_text("<!doctype html>")
    site = Starlette(routes=[Mount("/", app=SinglePageApp(directory=tmp_path))])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=site), base_url="http://test"
    ) as probe:
        assert (await probe.get("/.well-known/openid-configuration")).status_code == 404
        page = await probe.get("/oauth/authorize?client_id=x")
        assert page.status_code == 200
        assert page.text == "<!doctype html>"
