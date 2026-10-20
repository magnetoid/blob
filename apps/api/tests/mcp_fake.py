"""A fake MCP server for the tests of Blob as an MCP client (ADR 0027).

It speaks either era the way real servers do — the modern stateless revision, checking
the headers against the body as the spec makes a server do, or a legacy one with an
`initialize` handshake and a session it can forget — and keeps every request, so a test
can say what Blob sent as well as what it made of the answer.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from blob_api.plugins import mcp_client

#: The real client class, taken before any fixture replaces `httpx.AsyncClient` — the agent
#: fixtures patch it on the module itself, which would hand this server's requests to a
#: fake agent instead.
REAL_CLIENT = httpx.AsyncClient

HOST = "apps.example.com"
URL = f"https://{HOST}/mcp"


def default_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": "search_issues",
            "title": "Search issues",
            "description": "Find issues by what they say.",
            "inputSchema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            "annotations": {"readOnlyHint": True},
        },
        {
            "name": "create_issue",
            "title": "Create issue",
            "description": "Open a new issue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "x-mcp-header": "Repo"},
                    "title": {"type": "string"},
                },
                "required": ["repo", "title"],
            },
        },
    ]


def decoded(value: str | None) -> str | None:
    """A header value as a server reads it, sentinel and all."""
    if value is not None and value.startswith("=?base64?") and value.endswith("?="):
        return base64.b64decode(value[len("=?base64?") : -2]).decode()
    return value


class FakeMcpServer:
    def __init__(
        self,
        *,
        era: str = "modern",
        tools: list[dict[str, Any]] | None = None,
        legacy_version: str = "2025-06-18",
        page_size: int = 50,
        sse: bool = False,
        token: str | None = None,
    ) -> None:
        self.era = era
        self.tools = default_tools() if tools is None else tools
        self.legacy_version = legacy_version
        self.page_size = page_size
        self.sse = sse
        self.token = token
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        #: A tool's answer, by name: a result object or a function of the arguments.
        self.results: dict[str, Any] = {}
        #: Every request answers this status, when set.
        self.fail_with: int | None = None
        self.sessions: set[str] = set()
        self._next_session = 1

    # ── what tests read ──
    def methods(self) -> list[str]:
        return [str(body.get("method")) for body in self.bodies]

    def install(self, monkeypatch: pytest.MonkeyPatch) -> FakeMcpServer:
        def client() -> httpx.AsyncClient:
            return REAL_CLIENT(transport=httpx.MockTransport(self.handle), follow_redirects=False)

        monkeypatch.setattr(mcp_client, "open_client", client)
        return self

    # ── the server ──
    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail_with is not None:
            return httpx.Response(self.fail_with, text="the server is down")
        if (
            self.token is not None
            and request.headers.get("authorization") != f"Bearer {self.token}"
        ):
            return httpx.Response(
                401,
                headers={
                    "www-authenticate": (
                        f'Bearer resource_metadata="https://{HOST}/.well-known/oauth-protected-resource"'
                    )
                },
            )
        body = json.loads(request.content) if request.content else {}
        self.bodies.append(body)
        if self.era == "modern":
            return self._modern(request, body)
        return self._legacy(request, body)

    def _answer(
        self,
        body: dict[str, Any],
        result: dict[str, Any] | None = None,
        *,
        error: dict[str, Any] | None = None,
        status: int = 200,
    ) -> httpx.Response:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": body.get("id")}
        if error is not None:
            payload["error"] = error
        else:
            payload["result"] = result
        if self.sse and status == 200 and error is None:
            note = {"jsonrpc": "2.0", "method": "notifications/progress", "params": {"progress": 1}}
            stream = f": keep-alive\n\ndata: {json.dumps(note)}\n\ndata: {json.dumps(payload)}\n\n"
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=stream.encode()
            )
        return httpx.Response(status, json=payload)

    def _modern(self, request: httpx.Request, body: dict[str, Any]) -> httpx.Response:
        method = body.get("method")
        params = body.get("params") or {}
        meta = params.get("_meta") or {}
        version = request.headers.get("mcp-protocol-version")
        if version != "2026-07-28" or meta.get(mcp_client.VERSION_KEY) != "2026-07-28":
            return self._answer(
                body,
                error={
                    "code": -32022,
                    "message": "Unsupported protocol version",
                    "data": {"supported": ["2026-07-28"], "requested": version},
                },
                status=400,
            )
        if request.headers.get("mcp-method") != method:
            return self._answer(
                body, error={"code": -32020, "message": "Header mismatch"}, status=400
            )
        if method == "server/discover":
            return self._answer(
                body,
                {
                    "resultType": "complete",
                    "supportedVersions": ["2026-07-28"],
                    "capabilities": {"tools": {}},
                    "_meta": {mcp_client.SERVER_INFO_KEY: {"name": "fake", "version": "9.9"}},
                },
            )
        if method == "tools/list":
            return self._list(body, modern=True)
        if method == "tools/call":
            if decoded(request.headers.get("mcp-name")) != params.get("name"):
                return self._answer(
                    body, error={"code": -32020, "message": "Header mismatch"}, status=400
                )
            return self._call(body, modern=True)
        return self._answer(body, error={"code": -32601, "message": "Method not found"}, status=404)

    def _legacy(self, request: httpx.Request, body: dict[str, Any]) -> httpx.Response:
        method = body.get("method")
        if method == "initialize":
            session = f"sess-{self._next_session}"
            self._next_session += 1
            self.sessions.add(session)
            answer = self._answer(
                body,
                {
                    "protocolVersion": self.legacy_version,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "old-fake", "version": "1.0"},
                },
            )
            answer.headers["mcp-session-id"] = session
            return answer
        if method == "notifications/initialized":
            return httpx.Response(202)
        session = request.headers.get("mcp-session-id")
        if session is None:
            return self._answer(
                body,
                error={"code": -32000, "message": "Bad Request: No valid session ID provided"},
                status=400,
            )
        if session not in self.sessions:
            return self._answer(
                body, error={"code": -32001, "message": "Session not found"}, status=404
            )
        if request.headers.get("mcp-protocol-version") != self.legacy_version:
            return self._answer(
                body, error={"code": -32000, "message": "Unsupported protocol version"}, status=400
            )
        if method == "tools/list":
            return self._list(body, modern=False)
        if method == "tools/call":
            return self._call(body, modern=False)
        return self._answer(body, error={"code": -32601, "message": "Method not found"})

    def _list(self, body: dict[str, Any], *, modern: bool) -> httpx.Response:
        cursor = (body.get("params") or {}).get("cursor")
        start = int(cursor) if cursor else 0
        result: dict[str, Any] = {"tools": self.tools[start : start + self.page_size]}
        if start + self.page_size < len(self.tools):
            result["nextCursor"] = str(start + self.page_size)
        if modern:
            result.update({"resultType": "complete", "ttlMs": 60_000, "cacheScope": "private"})
        return self._answer(body, result)

    def _call(self, body: dict[str, Any], *, modern: bool) -> httpx.Response:
        params = body.get("params") or {}
        name = str(params.get("name"))
        arguments = params.get("arguments") or {}
        self.calls.append((name, arguments))
        answer = self.results.get(name)
        if answer is None:
            if not any(tool["name"] == name for tool in self.tools):
                return self._answer(
                    body, error={"code": -32602, "message": f"Unknown tool: {name}"}
                )
            result: dict[str, Any] = {
                "content": [
                    {
                        "type": "text",
                        "text": f"{name} ran with {json.dumps(arguments, sort_keys=True)}",
                    }
                ]
            }
        else:
            result = answer(arguments) if callable(answer) else dict(answer)
        if modern:
            result = {"resultType": "complete", **result}
        return self._answer(body, result)


def a_tool(name: str, **extra: Any) -> dict[str, Any]:
    return {
        "name": name,
        "description": f"The {name} tool.",
        "inputSchema": {"type": "object", "properties": {}},
        **extra,
    }


Answer = Callable[[dict[str, Any]], dict[str, Any]]

__all__ = ["HOST", "REAL_CLIENT", "URL", "FakeMcpServer", "a_tool", "decoded", "default_tools"]
