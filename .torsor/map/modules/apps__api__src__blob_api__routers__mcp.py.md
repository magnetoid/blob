---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/mcp.py

Symbols in `apps/api/src/blob_api/routers/mcp.py`.

- L87 `_result(request_id: Any, result: dict[str, Any])` (function)
- L91 `_error(request_id: Any, code: int, message: str, data: dict[str, Any] | None=None)` (function)
- L100 `_json(payload: dict[str, Any], status: int=200)` (function)
- L108 `_decoded(value: str)` (function) — A header value the client may have Base64-wrapped when it was not ASCII-safe.
- L121 `_tool_error(request_id: Any, message: str)` (function) — A refusal the model reads rather than one the transport swallows.
- L136 `_caller(request: Request)` (function)
- L144 `_unauthorized()` (function)
- L159 `mcp_endpoint(request: Request)` (function)
- L191 `_modern(request: Request, caller: mcp_service.McpCaller, body: dict[str, Any], method: str, request_id: Any, params: dict[str, Any], meta_version: Any)` (function) — A request that carries its own version and mirrors its shape into headers.
- L265 `_legacy(caller: mcp_service.McpCaller, method: str, request_id: Any, params: dict[str, Any], header_version: str | None)` (function) — A client that opens with `initialize` and expects a session that we do not need.
- L320 `_discovery()` (function)
- L329 `_call_tool(caller: mcp_service.McpCaller, request_id: Any, params: dict[str, Any])` (function)
- L355 `mcp_not_allowed()` (function) — The GET stream and DELETE session of the older transport, which we do not host.
- L372 `TokenSummary` (class)
- L380 `TokensOut` (class)
- L387 `CreateTokenInput` (class)
- L393 `CreatedTokenOut` (class)
- L400 `_summary(row: Any)` (function)
- L410 `_endpoint_url()` (function)
- L415 `list_tokens(user: SessionUser=Depends(current_user))` (function)
- L422 `create_token(payload: CreateTokenInput, user: SessionUser=Depends(current_user))` (function)
- L433 `revoke_token(token_id: IdParam, user: SessionUser=Depends(current_user))` (function)
