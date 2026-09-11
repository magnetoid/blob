---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
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
- L321 `_discovery()` (function)
- L330 `_call_tool(caller: mcp_service.McpCaller, request_id: Any, params: dict[str, Any])` (function)
- L356 `mcp_not_allowed()` (function) — The GET stream and DELETE session of the older transport, which we do not host.
- L373 `TokenSummary` (class)
- L381 `TokensOut` (class)
- L388 `CreateTokenInput` (class)
- L394 `CreatedTokenOut` (class)
- L401 `_summary(row: Any)` (function)
- L411 `_endpoint_url()` (function)
- L416 `list_tokens(user: SessionUser=Depends(current_user))` (function)
- L435 `create_token(payload: CreateTokenInput, user: SessionUser=Depends(current_user))` (function)
- L475 `revoke_token(token_id: IdParam, user: SessionUser=Depends(current_user))` (function)
