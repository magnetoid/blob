---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/routers/mcp.py

Symbols in `apps/api/src/blob_api/routers/mcp.py`.

- L88 `_result(request_id: Any, result: dict[str, Any])` (function)
- L92 `_error(request_id: Any, code: int, message: str, data: dict[str, Any] | None=None)` (function)
- L101 `_json(payload: dict[str, Any], status: int=200)` (function)
- L109 `_decoded(value: str)` (function) — A header value the client may have Base64-wrapped when it was not ASCII-safe.
- L122 `_tool_error(request_id: Any, message: str)` (function) — A refusal the model reads rather than one the transport swallows.
- L137 `_caller(request: Request)` (function)
- L145 `_unauthorized()` (function)
- L160 `mcp_endpoint(request: Request)` (function)
- L192 `_modern(request: Request, caller: mcp_service.McpCaller, body: dict[str, Any], method: str, request_id: Any, params: dict[str, Any], meta_version: Any)` (function) — A request that carries its own version and mirrors its shape into headers.
- L266 `_legacy(caller: mcp_service.McpCaller, method: str, request_id: Any, params: dict[str, Any], header_version: str | None)` (function) — A client that opens with `initialize` and expects a session that we do not need.
- L317 `_discovery()` (function)
- L326 `_call_tool(caller: mcp_service.McpCaller, request_id: Any, params: dict[str, Any])` (function)
- L352 `mcp_not_allowed()` (function) — The GET stream and DELETE session of the older transport, which we do not host.
- L369 `TokenSummary` (class)
- L377 `TokensOut` (class)
- L384 `CreateTokenInput` (class)
- L390 `CreatedTokenOut` (class)
- L397 `_summary(row: Any)` (function)
- L407 `_endpoint_url()` (function)
- L412 `list_tokens(user: SessionUser=Depends(current_user))` (function)
- L431 `create_token(payload: CreateTokenInput, user: SessionUser=Depends(current_user))` (function)
- L471 `revoke_token(token_id: IdParam, user: SessionUser=Depends(current_user))` (function)
