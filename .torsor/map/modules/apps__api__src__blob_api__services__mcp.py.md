---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/services/mcp.py

Symbols in `apps/api/src/blob_api/services/mcp.py`.

- L65 `McpCaller` (class) — The person an assistant is acting as.
- L76 `may_write(self)` (method)
- L80 `resolve_token(token: str)` (function) — The caller a bearer token names, or None. Never raises for a bad token.
- L271 `catalogue(caller: McpCaller)` (function) — The tools this token may call, in the shape `tools/list` returns.
- L302 `_when(value: str | None)` (function) — An ISO timestamp as something a model reads without arithmetic.
- L313 `_names(session: AsyncSession, user_ids: set[str])` (function)
- L325 `_body(message: Message)` (function)
- L342 `_transcript(messages: list[Message], names: dict[str, str])` (function)
- L350 `_limit(arguments: dict[str, Any])` (function)
- L359 `_required(arguments: dict[str, Any], key: str)` (function)
- L366 `_an_id(value: str, what: str)` (function) — An id, checked here rather than by Postgres.
- L379 `_resolve_channel(session: AsyncSession, caller: McpCaller, reference: str)` (function) — A channel id, or a #name. Names are what a person types at their assistant.
- L409 `_channel_label(name: str | None, kind: str)` (function)
- L420 `_whoami(caller: McpCaller, _arguments: dict[str, Any])` (function)
- L430 `_list_channels(caller: McpCaller, arguments: dict[str, Any])` (function)
- L464 `_dm_names(session: AsyncSession, caller: McpCaller, channels: list[Any])` (function) — Who a DM is with — a DM has no name, and "a direct message" names nothing.
- L491 `_read_channel(caller: McpCaller, arguments: dict[str, Any])` (function)
- L523 `_read_thread(caller: McpCaller, arguments: dict[str, Any])` (function)
- L543 `_search_messages(caller: McpCaller, arguments: dict[str, Any])` (function)
- L578 `_author_id(session: AsyncSession, caller: McpCaller, name: str | None)` (function) — `from:` resolved the way the app resolves it, or a refusal.
- L614 `_channel_names(session: AsyncSession, channel_ids: set[str])` (function)
- L626 `_list_people(caller: McpCaller, arguments: dict[str, Any])` (function)
- L661 `_post_message(caller: McpCaller, arguments: dict[str, Any])` (function)
- L715 `known(name: str)` (function)
- L719 `call(caller: McpCaller, name: str, arguments: dict[str, Any])` (function) — Run one tool. Raises `AppError` for anything the caller did wrong.
