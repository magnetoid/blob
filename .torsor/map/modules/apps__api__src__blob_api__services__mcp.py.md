---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T02:35:20'
updated: '2026-09-16T02:35:20'
---

# apps/api/src/blob_api/services/mcp.py

Symbols in `apps/api/src/blob_api/services/mcp.py`.

- L62 `McpCaller` (class) — The person an assistant is acting as.
- L83 `may_write(self)` (method)
- L87 `resolve_token(token: str)` (function) — The caller a bearer token names, or None. Never raises for a bad token.
- L129 `catalogue(caller: McpCaller)` (function) — The tools this token may call, in the shape `tools/list` returns.
- L139 `_when(value: str | None)` (function) — An ISO timestamp as something a model reads without arithmetic.
- L150 `_names(session: AsyncSession, user_ids: set[str])` (function)
- L162 `_body(message: Message)` (function)
- L179 `_transcript(messages: list[Message], names: dict[str, str])` (function)
- L187 `_limit(arguments: dict[str, Any])` (function)
- L196 `_required(arguments: dict[str, Any], key: str)` (function)
- L203 `_an_id(value: str, what: str)` (function) — An id, checked here rather than by Postgres.
- L216 `_resolve_channel(session: AsyncSession, caller: McpCaller, reference: str)` (function) — A channel id, or a #name. Names are what a person types at their assistant.
- L229 `_channel_label(name: str | None, kind: str)` (function)
- L240 `_whoami(caller: McpCaller, _arguments: dict[str, Any])` (function)
- L250 `_list_channels(caller: McpCaller, arguments: dict[str, Any])` (function)
- L284 `_dm_names(session: AsyncSession, caller: McpCaller, channels: list[Any])` (function) — Who a DM is with — a DM has no name, and "a direct message" names nothing.
- L311 `_read_channel(caller: McpCaller, arguments: dict[str, Any])` (function)
- L343 `_read_thread(caller: McpCaller, arguments: dict[str, Any])` (function)
- L363 `_search_messages(caller: McpCaller, arguments: dict[str, Any])` (function)
- L398 `_author_id(session: AsyncSession, caller: McpCaller, name: str | None)` (function) — `from:` resolved the way the app resolves it, or a refusal.
- L434 `_channel_names(session: AsyncSession, channel_ids: set[str])` (function)
- L446 `_list_people(caller: McpCaller, arguments: dict[str, Any])` (function)
- L481 `_post_message(caller: McpCaller, arguments: dict[str, Any])` (function)
- L536 `known(name: str)` (function)
- L540 `call(caller: McpCaller, name: str, arguments: dict[str, Any])` (function) — Run one tool. Raises `AppError` for anything the caller did wrong.
