"""Blob as an MCP server: two protocol eras, one identity, and no way round the ACLs.

The thing worth testing hardest is not the JSON-RPC envelope — it is that a token which
lets somebody's assistant in does not let it anywhere its owner could not go. Every read
below has a matching test from a second account that must not see it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from httpx_ws import aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs.notify import handle_notify
from blob_api.main import app

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@asynccontextmanager
async def socket_for(client: Client) -> AsyncIterator[Any]:
    """A live socket carrying that person's session — the room, watching."""
    async with AsyncClient(
        transport=ASGIWebSocketTransport(app=app),
        base_url="http://test",
        cookies=client._http.cookies,
    ) as http:
        async with aconnect_ws("/ws", http) as ws:
            yield ws


async def receive_until(ws: Any, kind: str, timeout: float = 3.0) -> dict[str, Any]:
    import asyncio

    async def _read() -> dict[str, Any]:
        while True:
            frame = json.loads(await ws.receive_text())
            if frame.get("t") == kind:
                return dict(frame)

    return await asyncio.wait_for(_read(), timeout)


MODERN = "2026-07-28"
LEGACY = "2025-06-18"


class Mcp:
    """A client speaking one era of the protocol, with a token and no cookies."""

    def __init__(self, client: Client, token: str, era: str = LEGACY) -> None:
        self._client = client
        self._client._http.headers["authorization"] = f"Bearer {token}"
        self.era = era

    async def raw(self, body: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
        return await self._client._http.post("/api/mcp", json=body, headers=headers or {})

    async def send(self, method: str, params: dict[str, Any] | None = None) -> Any:
        params = dict(params or {})
        headers = {"accept": "application/json, text/event-stream"}
        if self.era in ("2026-07-28",):
            params.setdefault("_meta", {})["io.modelcontextprotocol/protocolVersion"] = self.era
            headers["mcp-protocol-version"] = self.era
            headers["mcp-method"] = method
            if method == "tools/call":
                headers["mcp-name"] = str(params.get("name"))
        else:
            headers["mcp-protocol-version"] = self.era
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        return await self.raw(body, headers)

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        response = await self.send("tools/call", {"name": name, "arguments": arguments or {}})
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert result["isError"] is False, result
        return str(result["content"][0]["text"])

    async def refuse(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        """A tool that says no. `isError`, not a JSON-RPC error — the connection is fine."""
        response = await self.send("tools/call", {"name": name, "arguments": arguments or {}})
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert result["isError"] is True, result
        return str(result["content"][0]["text"])


async def mint(client: Client, name: str = "Claude Code", *, can_write: bool = False) -> str:
    made = await client.post("/api/me/mcp-tokens", {"name": name, "canWrite": can_write})
    assert made.status == 200, made.body
    return str(made.body["secret"])


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    private = (
        await owner.post(
            "/api/channels",
            {"name": "war-room", "kind": "private", "memberIds": [member.user_id]},
        )
    ).body["channel"]["id"]
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "general": general,
        "private": private,
    }


# ─── minting and revoking ──────────────────────────────────────────────────────


class TestTheTokenItself:
    async def test_the_secret_is_shown_once_and_never_stored(self, team: dict[str, Any]) -> None:
        secret = await mint(team["owner"])
        listed = await team["owner"].get("/api/me/mcp-tokens")
        assert listed.status == 200, listed.body
        assert listed.body["tokens"][0]["name"] == "Claude Code"
        assert listed.body["tokens"][0]["scopes"] == ["read"]
        assert secret not in listed.text if hasattr(listed, "text") else True

        async with SessionFactory() as session:
            stored = (await session.execute(text("SELECT token_hash FROM mcp_tokens"))).scalar_one()
        assert stored != secret, "the token itself must not be in the database"

    async def test_the_url_is_what_you_paste_into_an_assistant(self, team: dict[str, Any]) -> None:
        listed = await team["owner"].get("/api/me/mcp-tokens")
        assert listed.body["url"].endswith("/api/mcp")
        assert listed.body["url"].startswith("http")

    async def test_write_is_a_separate_decision(self, team: dict[str, Any]) -> None:
        await mint(team["owner"], "Read only")
        await mint(team["owner"], "Can post", can_write=True)
        listed = await team["owner"].get("/api/me/mcp-tokens")
        scopes = {row["name"]: row["scopes"] for row in listed.body["tokens"]}
        assert scopes == {"Read only": ["read"], "Can post": ["read", "write"]}

    async def test_a_revoked_token_stops_working_immediately(self, team: dict[str, Any]) -> None:
        secret = await mint(team["owner"])
        mcp = Mcp(team["owner"].fork(), secret)
        assert await mcp.call("whoami")

        listed = await team["owner"].get("/api/me/mcp-tokens")
        gone = await team["owner"].delete(f"/api/me/mcp-tokens/{listed.body['tokens'][0]['id']}")
        assert gone.status == 200, gone.body

        response = await mcp.send("tools/list")
        assert response.status_code == 401
        assert response.headers["www-authenticate"].startswith("Bearer")

    async def test_somebody_else_cannot_revoke_your_connection(self, team: dict[str, Any]) -> None:
        await mint(team["owner"])
        listed = await team["owner"].get("/api/me/mcp-tokens")
        token_id = listed.body["tokens"][0]["id"]
        refused = await team["member"].delete(f"/api/me/mcp-tokens/{token_id}")
        assert refused.status == 404, refused.body

    async def test_you_only_see_your_own(self, team: dict[str, Any]) -> None:
        await mint(team["owner"], "Owner's")
        await mint(team["member"], "Member's")
        listed = await team["owner"].get("/api/me/mcp-tokens")
        assert [row["name"] for row in listed.body["tokens"]] == ["Owner's"]

    async def test_minting_is_audited(self, team: dict[str, Any]) -> None:
        await mint(team["owner"], "Audited", can_write=True)
        audit = await team["owner"].get("/api/admin/audit?action=mcp_token.created")
        assert audit.body["events"][0]["metadata"]["scopes"] == ["read", "write"]

    async def test_the_endpoint_needs_a_token(self, team: dict[str, Any]) -> None:
        anonymous = team["owner"].fork()
        response = await anonymous._http.post(
            "/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )
        assert response.status_code == 401
        # A JSON-RPC body, not Blob's error envelope: it is an MCP client reading this.
        assert response.json()["jsonrpc"] == "2.0"

    async def test_minting_still_needs_a_session(self, team: dict[str, Any]) -> None:
        """`/api/mcp` is public; the routes that mint credentials must not be."""
        anonymous = team["owner"].fork()
        response = await anonymous._http.post("/api/me/mcp-tokens", json={"name": "sneaky"})
        assert response.status_code == 401


# ─── the two protocol eras ─────────────────────────────────────────────────────


class TestLegacyClients:
    async def test_initialize_agrees_on_the_version_it_was_asked_for(
        self, team: dict[str, Any]
    ) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.send(
            "initialize",
            {"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "t"}},
        )
        assert response.status_code == 200
        result = response.json()["result"]
        assert result["protocolVersion"] == LEGACY
        assert result["capabilities"]["tools"] == {"listChanged": False}
        assert result["serverInfo"]["name"] == "blob"
        assert "workspace" in result["instructions"]
        # No session to keep: every request stands alone, so a second container answers.
        assert "mcp-session-id" not in {k.lower() for k in response.headers}

    async def test_a_version_we_do_not_speak_is_answered_with_one_we_do(
        self, team: dict[str, Any]
    ) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.send("initialize", {"protocolVersion": "1999-01-01"})
        assert response.json()["result"]["protocolVersion"] == "2025-11-25"

    async def test_a_handshake_can_only_agree_a_handshake_version(
        self, team: dict[str, Any]
    ) -> None:
        """A legacy client that asks for a modern revision must not be told yes.

        It has no `_meta` to send, so agreeing would 400 every request it made after —
        a server that says "yes" and then refuses everything.
        """
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        agreed = (await mcp.send("initialize", {"protocolVersion": MODERN})).json()["result"]
        assert agreed["protocolVersion"] == "2025-11-25"

        # And the client can then actually use what it was given.
        listed = await mcp.send("tools/list")
        assert listed.status_code == 200, listed.text

    async def test_the_initialized_notification_is_accepted_and_silent(
        self, team: dict[str, Any]
    ) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.raw(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"mcp-protocol-version": LEGACY},
        )
        assert response.status_code == 202
        assert response.content == b""

    async def test_ping_answers(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.send("ping")
        assert response.json()["result"] == {}

    async def test_an_unknown_method_is_a_method_not_found(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.send("resources/list")
        assert response.json()["error"]["code"] == -32601


class TestModernClients:
    async def test_no_handshake_is_needed_at_all(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        response = await mcp.send("tools/list")
        assert response.status_code == 200
        assert [tool["name"] for tool in response.json()["result"]["tools"]]

    async def test_discover_names_every_version_we_speak(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        result = (await mcp.send("server/discover")).json()["result"]
        assert MODERN in result["protocolVersions"]
        assert LEGACY in result["protocolVersions"]
        assert result["serverInfo"]["name"] == "blob"

    async def test_a_header_that_disagrees_with_the_body_is_refused(
        self, team: dict[str, Any]
    ) -> None:
        """The whole point of mirroring: a proxy and the server cannot be made to differ."""
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        response = await mcp.raw(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "whoami",
                    "arguments": {},
                    "_meta": {"io.modelcontextprotocol/protocolVersion": MODERN},
                },
            },
            {
                "mcp-protocol-version": MODERN,
                "mcp-method": "tools/call",
                "mcp-name": "post_message",  # not what the body says
            },
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == -32020

    async def test_a_missing_method_header_is_refused(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        response = await mcp.raw(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {"_meta": {"io.modelcontextprotocol/protocolVersion": MODERN}},
            },
            {"mcp-protocol-version": MODERN},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == -32020

    async def test_a_base64_wrapped_name_header_still_matches(self, team: dict[str, Any]) -> None:
        import base64

        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        wrapped = "=?base64?" + base64.b64encode(b"whoami").decode() + "?="
        response = await mcp.raw(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "whoami",
                    "arguments": {},
                    "_meta": {"io.modelcontextprotocol/protocolVersion": MODERN},
                },
            },
            {
                "mcp-protocol-version": MODERN,
                "mcp-method": "tools/call",
                "mcp-name": wrapped,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["result"]["isError"] is False

    async def test_an_unknown_modern_method_is_a_404_with_a_json_rpc_body(
        self, team: dict[str, Any]
    ) -> None:
        """What tells a client "modern server, wrong method" from "wrong endpoint"."""
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]), era=MODERN)
        response = await mcp.send("prompts/list")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == -32601

    async def test_the_get_stream_and_delete_session_are_gone(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        for method in ("GET", "DELETE"):
            response = await mcp._client._http.request(method, "/api/mcp")
            assert response.status_code == 405, method


# ─── the tools ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def talking(team: dict[str, Any]) -> dict[str, Any]:
    await send_message(team["owner"], team["general"], "the deploy went out at nine")
    root = await send_message(team["owner"], team["general"], "shipping the search fix")
    await send_message(
        team["member"], team["general"], "nice", threadRootId=root.body["message"]["id"]
    )
    await send_message(team["owner"], team["private"], "the incident postmortem")
    return {**team, "root_id": root.body["message"]["id"]}


class TestReading:
    async def test_whoami_says_who_and_what_it_may_do(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("whoami")
        assert "Owner" in said and "Test Workspace" in said
        assert "read only" in said

        writer = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        assert "read and post" in await writer.call("whoami")

    async def test_a_read_only_token_is_not_even_offered_the_write_tool(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        listed = (await mcp.send("tools/list")).json()["result"]["tools"]
        names = {tool["name"] for tool in listed}
        assert "read_channel" in names
        assert "post_message" not in names, "a model must not be shown a tool it cannot call"
        assert all(tool["annotations"]["readOnlyHint"] for tool in listed)

    async def test_a_writing_token_is(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        listed = (await mcp.send("tools/list")).json()["result"]["tools"]
        assert "post_message" in {tool["name"] for tool in listed}

    async def test_list_channels_shows_what_this_person_can_see(
        self, talking: dict[str, Any]
    ) -> None:
        owner = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        assert "#war-room" in await owner.call("list_channels")

        outsider = Mcp(talking["outsider"].fork(), await mint(talking["outsider"]))
        listed = await outsider.call("list_channels")
        assert "#general" in listed
        assert "war-room" not in listed, "a private channel is not even listed"

    async def test_read_channel_reads_oldest_first_and_carries_ids(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("read_channel", {"channel": "#general"})
        assert said.index("the deploy went out") < said.index("shipping the search fix")
        assert talking["root_id"] in said
        assert "Owner:" in said

    async def test_a_private_channel_is_a_refusal_not_a_leak(self, talking: dict[str, Any]) -> None:
        outsider = Mcp(talking["outsider"].fork(), await mint(talking["outsider"]))
        # By name and by id alike: neither may confirm that the channel is there.
        assert "no channel by that name" in await outsider.refuse(
            "read_channel", {"channel": "#war-room"}
        )
        by_id = await outsider.refuse("read_channel", {"channel": talking["private"]})
        assert "postmortem" not in by_id

    async def test_read_thread_gives_the_root_once(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("read_thread", {"message_id": talking["root_id"]})
        assert said.count("shipping the search fix") == 1
        assert "1 reply" in said
        assert "Member: nice" in said

    async def test_a_thread_in_a_channel_you_cannot_see_is_refused(
        self, talking: dict[str, Any]
    ) -> None:
        secret = await send_message(talking["owner"], talking["private"], "only for us")
        outsider = Mcp(talking["outsider"].fork(), await mint(talking["outsider"]))
        refusal = await outsider.refuse("read_thread", {"message_id": secret.body["message"]["id"]})
        assert "only for us" not in refusal

    async def test_search_finds_what_you_can_see_and_no_more(self, talking: dict[str, Any]) -> None:
        owner = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        assert "postmortem" in await owner.call("search_messages", {"query": "postmortem"})

        outsider = Mcp(talking["outsider"].fork(), await mint(talking["outsider"]))
        assert "Nothing matches" in await outsider.call("search_messages", {"query": "postmortem"})

    async def test_search_takes_the_same_modifiers_the_app_does(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("search_messages", {"query": "from:Owner in:#general deploy"})
        assert "the deploy went out" in said

    async def test_a_name_that_matches_nobody_is_said_out_loud(
        self, talking: dict[str, Any]
    ) -> None:
        """Not an empty result: an assistant cannot tell that from a quiet workspace."""
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        assert "names nobody" in await mcp.refuse(
            "search_messages", {"query": "from:Nobody deploy"}
        )

    async def test_filters_with_nothing_to_search_for_are_refused(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        assert "not only filters" in await mcp.refuse("search_messages", {"query": "in:#general"})

    async def test_list_people_gives_the_names_a_message_can_at(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("list_people")
        assert "@Owner" in said and "@Member" in said

    async def test_a_limit_is_capped_rather_than_obeyed(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        said = await mcp.call("read_channel", {"channel": "#general", "limit": 100000})
        assert said, "an absurd limit is clamped, not a 500"

    async def test_an_id_a_model_invented_is_told_so_rather_than_crashing(
        self, talking: dict[str, Any]
    ) -> None:
        """A model hands back ids it read; sometimes it hands back something else.

        Unchecked these reach `cast(... AS uuid)` and come out as a 500, which an
        assistant reads as "the server is broken" rather than "I made that up".
        """
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        assert "not a message id" in await mcp.refuse(
            "read_thread", {"message_id": "the-first-one"}
        )
        assert "not a message id" in await mcp.refuse(
            "read_channel", {"channel": "#general", "before": "yesterday"}
        )
        assert "not a channel id or name" in await mcp.refuse(
            "read_channel", {"channel": "the one about deploys"}
        )

    async def test_an_unknown_tool_is_a_protocol_error(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        response = await mcp.send("tools/call", {"name": "drop_database", "arguments": {}})
        assert response.json()["error"]["code"] == -32602


class TestWriting:
    async def test_a_post_lands_as_the_person_and_is_broadcast(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        said = await mcp.call(
            "post_message", {"channel": "#general", "text": "posted from my terminal"}
        )
        assert "Posted as Owner" in said

        # Visible to everybody else through the ordinary read path, which is the proof
        # that it went through `send` and `announce` rather than into the table.
        history = await talking["member"].get(f"/api/channels/{talking['general']}/messages")
        bodies = [message["body"] for message in history.body["messages"]]
        assert "posted from my terminal" in bodies
        posted = next(m for m in history.body["messages"] if m["body"] == "posted from my terminal")
        assert posted["authorId"] == talking["owner"].user_id

    async def test_a_reply_goes_into_the_thread(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        await mcp.call(
            "post_message",
            {
                "channel": "#general",
                "text": "and it is green",
                "thread_root_id": talking["root_id"],
            },
        )
        thread = await talking["owner"].get(f"/api/messages/{talking['root_id']}/thread")
        assert "and it is green" in [m["body"] for m in thread.body["messages"]]

    async def test_a_read_only_token_cannot_post(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        refusal = await mcp.refuse(
            "post_message", {"channel": "#general", "text": "should not appear"}
        )
        assert "may only read" in refusal
        history = await talking["owner"].get(f"/api/channels/{talking['general']}/messages")
        assert "should not appear" not in [m["body"] for m in history.body["messages"]]

    async def test_posting_where_you_are_not_a_member_is_refused(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["outsider"].fork(), await mint(talking["outsider"], "w", can_write=True))
        refusal = await mcp.refuse(
            "post_message", {"channel": talking["private"], "text": "hello?"}
        )
        assert "hello?" not in refusal
        history = await talking["owner"].get(f"/api/channels/{talking['private']}/messages")
        assert "hello?" not in [m["body"] for m in history.body["messages"]]

    async def test_the_room_sees_it_live(self, talking: dict[str, Any]) -> None:
        """The half a stored row does not buy: `announce` past COMMIT, or nobody is told.

        Writing the message and skipping this is exactly the bug the scheduled sweep had
        — stored, and delivered only to whoever happened to reload.
        """
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        async with socket_for(talking["member"]) as ws:
            await mcp.call("post_message", {"channel": "#general", "text": "live from outside"})
            frame = await receive_until(ws, "message.new")
        assert frame["message"]["body"] == "live from outside"

    async def test_a_mention_raises_the_badge(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        said = await mcp.call(
            "post_message", {"channel": "#general", "text": "@Member could you look?"}
        )
        message_id = said.rsplit(" ", 1)[1].rstrip(".")

        # The worker's half, run by hand the way every other badge test runs it.
        await handle_notify(message_id)

        states = (await talking["member"].get("/api/read-states")).body["readStates"]
        badge = next((s["mentionCount"] for s in states if s["channelId"] == talking["general"]), 0)
        assert badge == 1

    async def test_posting_into_an_archived_channel_is_refused(
        self, talking: dict[str, Any]
    ) -> None:
        made = await talking["owner"].post("/api/channels", {"name": "old-news", "kind": "public"})
        channel_id = made.body["channel"]["id"]
        await talking["owner"].post(f"/api/channels/{channel_id}/archive")
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"], "w", can_write=True))
        assert await mcp.refuse("post_message", {"channel": "#old-news", "text": "hello"})


class TestTheTokenIsThePerson:
    async def test_deactivating_somebody_silences_their_assistant(
        self, talking: dict[str, Any]
    ) -> None:
        secret = await mint(talking["member"])
        mcp = Mcp(talking["member"].fork(), secret)
        assert await mcp.call("whoami")

        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE users SET deactivated_at = now() WHERE id = :id"),
                {"id": talking["member"].user_id},
            )
        assert (await mcp.send("tools/list")).status_code == 401

    async def test_leaving_a_channel_takes_the_assistant_with_you(
        self, talking: dict[str, Any]
    ) -> None:
        mcp = Mcp(talking["member"].fork(), await mint(talking["member"]))
        assert "postmortem" in await mcp.call("read_channel", {"channel": "#war-room"})

        await talking["member"].post(f"/api/channels/{talking['private']}/leave")
        assert "postmortem" not in await mcp.refuse("read_channel", {"channel": "#war-room"})

    async def test_an_assistant_in_a_loop_is_stopped(self, talking: dict[str, Any]) -> None:
        """Keyed by the person, so a second connection buys no second allowance."""
        from blob_api.lib.rate_limit import LIMITS, Limit

        original = LIMITS["mcp_tool"]
        LIMITS["mcp_tool"] = Limit(3, 60)
        try:
            one = Mcp(talking["owner"].fork(), await mint(talking["owner"], "one"))
            two = Mcp(talking["owner"].fork(), await mint(talking["owner"], "two"))
            for _ in range(3):
                await one.call("whoami")
            assert "too many" in (await two.refuse("whoami")).lower()
        finally:
            LIMITS["mcp_tool"] = original

    async def test_last_used_is_recorded(self, talking: dict[str, Any]) -> None:
        mcp = Mcp(talking["owner"].fork(), await mint(talking["owner"]))
        await mcp.call("whoami")
        listed = await talking["owner"].get("/api/me/mcp-tokens")
        assert listed.body["tokens"][0]["lastUsedAt"] is not None


class TestBadInput:
    @pytest.mark.parametrize("body", ["not json at all", "[]", "42"])
    async def test_rubbish_is_a_json_rpc_error_not_a_stack_trace(
        self, team: dict[str, Any], body: str
    ) -> None:
        client = team["owner"].fork()
        client._http.headers["authorization"] = f"Bearer {await mint(team['owner'])}"
        response = await client._http.post(
            "/api/mcp", content=body, headers={"content-type": "application/json"}
        )
        assert response.status_code == 400
        assert response.json()["jsonrpc"] == "2.0"

    async def test_a_message_with_no_method_is_refused(self, team: dict[str, Any]) -> None:
        mcp = Mcp(team["owner"].fork(), await mint(team["owner"]))
        response = await mcp.raw({"jsonrpc": "2.0", "id": 1})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == -32600
