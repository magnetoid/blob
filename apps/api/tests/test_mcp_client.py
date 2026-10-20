"""Blob as an MCP client: what it sends a server, and what it makes of the answer (ADR 0027).

Against a fake server in each era. The modern revision (`2026-07-28`) has no handshake and
checks headers against the body; a legacy one wants `initialize` and a session it may
forget. Blob has to tell them apart the way the transport spec says, mirror what a tool
marks into headers, read an event stream past its notifications, and turn every answer —
text, structured, an image, a refusal, a request for input — into something an agent can
read, without ever following a redirect or reaching an address inside the network.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from typing import Any

import httpx
import pytest

from blob_api.lib import net
from blob_api.plugins import mcp_client
from blob_api.plugins.mcp_client import Endpoint, McpError

from .mcp_fake import HOST, REAL_CLIENT, URL, FakeMcpServer, a_tool, decoded


@pytest.fixture(autouse=True)
def _public_example_host(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """`apps.example.com` resolves nowhere; it alone is waved through, and every other name
    still meets the real guard."""
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == HOST else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)
    mcp_client.reset_for_tests()
    yield
    mcp_client.reset_for_tests()


def endpoint(**overrides: Any) -> Endpoint:
    return Endpoint(**{"server_id": "s1", "url": URL, **overrides})


CREATE_SCHEMA = {
    "type": "object",
    "properties": {
        "repo": {"type": "string", "x-mcp-header": "Repo"},
        "title": {"type": "string"},
    },
}


class TestListing:
    async def test_a_modern_server_is_listed_without_a_handshake(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        listing = await mcp_client.list_tools(endpoint())

        assert (listing.era, listing.protocol_version) == ("modern", "2026-07-28")
        assert listing.server_name == "fake"
        assert [tool.name for tool in listing.tools] == ["search_issues", "create_issue"]
        assert [tool.read_only for tool in listing.tools] == [True, False]
        assert server.methods() == ["server/discover", "tools/list"]
        for request, body in zip(server.requests, server.bodies, strict=True):
            assert request.headers["mcp-protocol-version"] == "2026-07-28"
            assert request.headers["mcp-method"] == body["method"]
            meta = body["params"]["_meta"]
            assert meta[mcp_client.VERSION_KEY] == "2026-07-28"
            assert meta[mcp_client.CLIENT_INFO_KEY]["name"] == "blob"
            # Blob offers a server nothing to call back into: no sampling, no elicitation.
            assert meta[mcp_client.CAPABILITIES_KEY] == {}
            assert "mcp-session-id" not in request.headers

    async def test_every_page_is_followed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        tools = [a_tool(f"t{n}") for n in range(5)]
        server = FakeMcpServer(tools=tools, page_size=2).install(monkeypatch)
        listing = await mcp_client.list_tools(endpoint())
        assert [tool.name for tool in listing.tools] == [f"t{n}" for n in range(5)]
        assert server.methods().count("tools/list") == 3

    async def test_a_legacy_server_gets_its_handshake_and_its_session(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer(era="legacy").install(monkeypatch)
        listing = await mcp_client.list_tools(endpoint())

        assert (listing.era, listing.protocol_version) == ("legacy", "2025-06-18")
        assert listing.server_name == "old-fake"
        assert server.methods() == [
            "server/discover",
            "initialize",
            "notifications/initialized",
            "tools/list",
        ]
        initialize = server.bodies[1]["params"]
        assert initialize["protocolVersion"] == "2025-11-25"
        assert initialize["capabilities"] == {}
        listed = server.requests[-1]
        assert listed.headers["mcp-session-id"] == "sess-1"
        assert listed.headers["mcp-protocol-version"] == "2025-06-18"

    async def test_a_tool_with_a_broken_header_mark_is_left_out_and_said_why(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        number = {"type": "object", "properties": {"n": {"type": "number", "x-mcp-header": "N"}}}
        in_items = {
            "type": "object",
            "properties": {
                "xs": {"type": "array", "items": {"type": "string", "x-mcp-header": "X"}}
            },
        }
        twice = {
            "type": "object",
            "properties": {
                "a": {"type": "string", "x-mcp-header": "Same"},
                "b": {"type": "string", "x-mcp-header": "same"},
            },
        }
        tools = [
            a_tool("fine"),
            {**a_tool("on_a_number"), "inputSchema": number},
            {**a_tool("in_an_array"), "inputSchema": in_items},
            {**a_tool("named_twice"), "inputSchema": twice},
            {"name": "no_schema"},
            a_tool("fine"),
        ]
        FakeMcpServer(tools=tools).install(monkeypatch)
        listing = await mcp_client.list_tools(endpoint())

        assert [tool.name for tool in listing.tools] == ["fine"]
        reasons = " / ".join(listing.skipped)
        for name in ("on_a_number", "in_an_array", "named_twice", "no_schema"):
            assert name in reasons
        assert "listed twice" in reasons

    async def test_a_server_that_wants_oauth_says_so(self, monkeypatch: pytest.MonkeyPatch) -> None:
        FakeMcpServer(token="right").install(monkeypatch)
        with pytest.raises(McpError) as refused:
            await mcp_client.list_tools(endpoint(secret=("Authorization", "Bearer wrong")))
        assert "OAuth" in refused.value.message and "401" in refused.value.message

    async def test_the_secret_header_is_sent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        server = FakeMcpServer(token="right").install(monkeypatch)
        await mcp_client.list_tools(endpoint(secret=("Authorization", "Bearer right")))
        assert all(r.headers["authorization"] == "Bearer right" for r in server.requests)

    async def test_a_server_that_cannot_answer_is_an_error_in_words(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        server.fail_with = 503
        with pytest.raises(McpError) as failed:
            await mcp_client.list_tools(endpoint())
        assert "503" in failed.value.message


class TestCalling:
    async def test_a_call_mirrors_its_name_and_marked_arguments_into_headers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        result = await mcp_client.call_tool(
            endpoint(era="modern", protocol_version="2026-07-28"),
            "create_issue",
            CREATE_SCHEMA,
            {"repo": "blob/ünïcode", "title": "Fix it"},
            timeout_sec=5,
        )
        assert not result.is_error
        assert result.text.startswith("create_issue ran with")
        [request] = server.requests  # the era was known: no probe
        assert request.headers["mcp-method"] == "tools/call"
        assert request.headers["mcp-name"] == "create_issue"
        # Not plain ASCII, so carried in the transport's base64 sentinel.
        assert request.headers["mcp-param-repo"].startswith("=?base64?")
        assert decoded(request.headers["mcp-param-repo"]) == "blob/ünïcode"
        assert server.calls == [("create_issue", {"repo": "blob/ünïcode", "title": "Fix it"})]

    async def test_an_argument_left_out_sends_no_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        await mcp_client.call_tool(
            endpoint(era="modern"), "create_issue", CREATE_SCHEMA, {"title": "x"}, timeout_sec=5
        )
        assert "mcp-param-repo" not in server.requests[0].headers

    async def test_a_legacy_session_is_reused_then_reopened_when_forgotten(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer(era="legacy").install(monkeypatch)
        known = endpoint(era="legacy", protocol_version="2025-06-18")
        schema = {"type": "object", "properties": {"query": {"type": "string"}}}

        await mcp_client.call_tool(known, "search_issues", schema, {"query": "a"}, timeout_sec=5)
        await mcp_client.call_tool(known, "search_issues", schema, {"query": "b"}, timeout_sec=5)
        # One handshake for two calls.
        assert server.methods().count("initialize") == 1

        server.sessions.clear()  # the server restarted and forgot it
        result = await mcp_client.call_tool(
            known, "search_issues", schema, {"query": "c"}, timeout_sec=5
        )
        assert not result.is_error
        assert server.methods().count("initialize") == 2
        assert [args["query"] for _, args in server.calls] == ["a", "b", "c"]

    async def test_a_server_that_moved_eras_is_probed_once_and_called(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The row says legacy; the server has since upgraded and refuses a handshake shape.
        server = FakeMcpServer(era="modern").install(monkeypatch)
        result = await mcp_client.call_tool(
            endpoint(era="legacy", protocol_version="2025-06-18"),
            "search_issues",
            {"type": "object"},
            {"query": "x"},
            timeout_sec=5,
        )
        assert not result.is_error
        assert (result.era, result.protocol_version) == ("modern", "2026-07-28")
        assert "server/discover" in server.methods()

    async def test_an_event_stream_is_read_past_its_notifications(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer(sse=True).install(monkeypatch)
        result = await mcp_client.call_tool(
            endpoint(era="modern"),
            "search_issues",
            {"type": "object"},
            {"query": "x"},
            timeout_sec=5,
        )
        assert result.text.startswith("search_issues ran with")

    async def test_what_a_result_becomes_for_the_agent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        server.results["search_issues"] = {
            "content": [
                {"type": "text", "text": "Two issues."},
                {"type": "image", "data": "AAAA", "mimeType": "image/png"},
                {"type": "resource_link", "uri": "https://x.test/1", "name": "Issue 1"},
                {"type": "resource", "resource": {"uri": "file:///a.txt", "text": "inline"}},
            ]
        }
        result = await mcp_client.call_tool(
            endpoint(era="modern"), "search_issues", {"type": "object"}, {}, timeout_sec=5
        )
        assert result.text.split("\n\n") == [
            "Two issues.",
            "[The tool returned an image (image/png); Blob does not pass it on.]",
            "[Link: Issue 1 — https://x.test/1]",
            "inline",
        ]

    async def test_structured_content_is_used_when_there_is_no_text(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        server.results["search_issues"] = {"content": [], "structuredContent": {"count": 2}}
        result = await mcp_client.call_tool(
            endpoint(era="modern"), "search_issues", {"type": "object"}, {}, timeout_sec=5
        )
        assert json.loads(result.text) == {"count": 2}

    async def test_a_tool_that_failed_and_one_that_wants_input_are_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        server.results["search_issues"] = {
            "content": [{"type": "text", "text": "Rate limited."}],
            "isError": True,
        }
        server.results["create_issue"] = {
            "resultType": "input_required",
            "inputRequests": {"login": {"method": "elicitation/create", "params": {}}},
        }
        failed = await mcp_client.call_tool(
            endpoint(era="modern"), "search_issues", {"type": "object"}, {}, timeout_sec=5
        )
        assert failed.is_error and failed.text == "Rate limited."

        wants = await mcp_client.call_tool(
            endpoint(era="modern"), "create_issue", {"type": "object"}, {}, timeout_sec=5
        )
        assert wants.is_error and "more input" in wants.text

    async def test_a_refused_call_is_a_result_the_agent_can_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        FakeMcpServer().install(monkeypatch)
        result = await mcp_client.call_tool(
            endpoint(era="modern"), "no_such_tool", {"type": "object"}, {}, timeout_sec=5
        )
        assert result.is_error
        assert "Unknown tool: no_such_tool" in result.text


class TestTheNetwork:
    async def test_an_address_inside_the_network_is_never_asked(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        with pytest.raises(McpError) as refused:
            await mcp_client.list_tools(endpoint(url="https://10.0.0.5/mcp"))
        assert "network" in refused.value.message
        assert server.requests == []

    async def test_a_private_address_is_reached_where_the_operator_allows_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        await mcp_client.list_tools(endpoint(url="http://127.0.0.1:3000/mcp", private_ok=True))
        assert server.requests

    async def test_a_redirect_is_not_followed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def redirect(request: httpx.Request) -> httpx.Response:
            return httpx.Response(307, headers={"location": "https://10.0.0.5/mcp"})

        monkeypatch.setattr(
            mcp_client,
            "open_client",
            lambda: REAL_CLIENT(transport=httpx.MockTransport(redirect), follow_redirects=False),
        )
        with pytest.raises(McpError) as refused:
            await mcp_client.list_tools(endpoint())
        assert "redirect" in refused.value.message

    async def test_an_answer_past_the_budget_is_not_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        server = FakeMcpServer().install(monkeypatch)
        server.results["search_issues"] = {"content": [{"type": "text", "text": "x" * 5000}]}
        monkeypatch.setattr(mcp_client, "MAX_RESPONSE_BYTES", 1000)
        with pytest.raises(McpError) as refused:
            await mcp_client.call_tool(
                endpoint(era="modern"), "search_issues", {"type": "object"}, {}, timeout_sec=5
            )
        assert "more than Blob will read" in refused.value.message


class TestHeaders:
    @pytest.mark.parametrize(
        ("value", "sent"),
        [
            ("us-west1", "us-west1"),
            ("Hello, 世界", "=?base64?SGVsbG8sIOS4lueVjA==?="),
            (" padded ", "=?base64?IHBhZGRlZCA=?="),
            ("line1\nline2", "=?base64?bGluZTEKbGluZTI=?="),
            ("=?base64?literal?=", "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?="),
        ],
    )
    def test_values_are_encoded_as_the_transport_spec_shows(self, value: str, sent: str) -> None:
        # The spec's own examples, verbatim.
        assert mcp_client.header_value(value) == sent

    def test_marks_are_read_through_nested_properties(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "where": {
                    "type": "object",
                    "properties": {"region": {"type": "string", "x-mcp-header": "Region"}},
                },
                "dry": {"type": "boolean", "x-mcp-header": "Dry"},
            },
        }
        assert mcp_client.param_headers(schema) == [
            ("Region", ("where", "region")),
            ("Dry", ("dry",)),
        ]
        assert mcp_client.strip_marks(schema)["properties"]["dry"] == {"type": "boolean"}


class TestAgainstBlobItself:
    """The other half of the protocol is Blob's own MCP endpoint (`routers/mcp.py`), which
    speaks both eras. Blob as a client, against Blob as a server, in this process: the
    discovery, the headers it checks against the body, and a call, end to end."""

    async def test_blob_lists_and_calls_its_own_tools(
        self, client: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.main import app

        from .helpers import send_message, sign_up
        from .test_mcp import mint

        owner = await sign_up(client, "Owner")
        general = (await owner.get("/api/channels")).body["channels"][0]["id"]
        await send_message(owner, general, "The launch moved to Friday.")
        secret = await mint(owner)
        monkeypatch.setattr(
            mcp_client,
            "open_client",
            lambda: REAL_CLIENT(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                follow_redirects=False,
            ),
        )
        blob = endpoint(
            url="http://test/api/mcp",
            secret=("Authorization", f"Bearer {secret}"),
            private_ok=True,
        )

        listing = await mcp_client.list_tools(blob)
        assert (listing.era, listing.protocol_version) == ("modern", "2026-07-28")
        assert listing.server_name == "blob"
        names = [tool.name for tool in listing.tools]
        assert "read_channel" in names and "search_messages" in names
        assert listing.skipped == []

        read_channel = next(tool for tool in listing.tools if tool.name == "read_channel")
        result = await mcp_client.call_tool(
            replace(blob, era=listing.era, protocol_version=listing.protocol_version),
            "read_channel",
            read_channel.input_schema,
            {"channel": "#general"},
            timeout_sec=10,
        )
        assert not result.is_error, result.text
        assert "The launch moved to Friday." in result.text
