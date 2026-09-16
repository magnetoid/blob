---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/mcp.py

Symbols in `apps/api/src/blob_api/services/mcp.py`.

- L62 `McpCaller` (class) — The person an assistant is acting as.
- L73 `may_write(self)` (method)
- L77 `resolve_token(token: str)` (function) — The caller a bearer token names, or None. Never raises for a bad token.
- L119 `catalogue(caller: McpCaller)` (function) — The tools this token may call, in the shape `tools/list` returns.
- L129 `_when(value: str | None)` (function) — An ISO timestamp as something a model reads without arithmetic.
- L140 `_names(session: AsyncSession, user_ids: set[str])` (function)
- L152 `_body(message: Message)` (function)
- L169 `_transcript(messages: list[Message], names: dict[str, str])` (function)
- L177 `_limit(arguments: dict[str, Any])` (function)
- L186 `_required(arguments: dict[str, Any], key: str)` (function)
- L193 `_an_id(value: str, what: str)` (function) — An id, checked here rather than by Postgres.
- L206 `_resolve_channel(session: AsyncSession, caller: McpCaller, reference: str)` (function) — A channel id, or a #name. Names are what a person types at their assistant.
- L219 `_channel_label(name: str | None, kind: str)` (function)
- L230 `_whoami(caller: McpCaller, _arguments: dict[str, Any])` (function)
- L240 `_list_channels(caller: McpCaller, arguments: dict[str, Any])` (function)
- L274 `_dm_names(session: AsyncSession, caller: McpCaller, channels: list[Any])` (function) — Who a DM is with — a DM has no name, and "a direct message" names nothing.
- L301 `_read_channel(caller: McpCaller, arguments: dict[str, Any])` (function)
- L333 `_read_thread(caller: McpCaller, arguments: dict[str, Any])` (function)
- L353 `_search_messages(caller: McpCaller, arguments: dict[str, Any])` (function)
- L388 `_author_id(session: AsyncSession, caller: McpCaller, name: str | None)` (function) — `from:` resolved the way the app resolves it, or a refusal.
- L424 `_channel_names(session: AsyncSession, channel_ids: set[str])` (function)
- L436 `_list_people(caller: McpCaller, arguments: dict[str, Any])` (function)
- L471 `_post_message(caller: McpCaller, arguments: dict[str, Any])` (function)
- L529 `known(name: str)` (function)
- L533 `call(caller: McpCaller, name: str, arguments: dict[str, Any])` (function) — Run one tool. Raises `AppError` for anything the caller did wrong.
