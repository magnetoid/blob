---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:40:01'
updated: '2026-09-16T01:40:01'
---

# apps/api/src/blob_api/services/mcp.py

Symbols in `apps/api/src/blob_api/services/mcp.py`.

- L65 `McpCaller` (class) — The person an assistant is acting as.
- L96 `may_write(self)` (method)
- L100 `reads_are_room_bound(self)` (method)
- L104 `resolve_token(token: str)` (function) — The caller a bearer token names, or None. Never raises for a bad token.
- L146 `catalogue(caller: McpCaller)` (function) — The tools this token may call, in the shape `tools/list` returns.
- L156 `_when(value: str | None)` (function) — An ISO timestamp as something a model reads without arithmetic.
- L167 `_names(session: AsyncSession, user_ids: set[str])` (function)
- L179 `_body(message: Message)` (function)
- L196 `_transcript(messages: list[Message], names: dict[str, str])` (function)
- L204 `_limit(arguments: dict[str, Any])` (function)
- L213 `_required(arguments: dict[str, Any], key: str)` (function)
- L220 `_an_id(value: str, what: str)` (function) — An id, checked here rather than by Postgres.
- L233 `_resolve_channel(session: AsyncSession, caller: McpCaller, reference: str)` (function) — A channel id, or a #name. Names are what a person types at their assistant.
- L251 `_refuse_outside_the_room(session: AsyncSession, caller: McpCaller, channel_id: str)` (function) — Stop a room-bound caller reading somewhere the room could not read.
- L278 `_channel_label(name: str | None, kind: str)` (function)
- L289 `_whoami(caller: McpCaller, _arguments: dict[str, Any])` (function)
- L299 `_list_channels(caller: McpCaller, arguments: dict[str, Any])` (function)
- L339 `_dm_names(session: AsyncSession, caller: McpCaller, channels: list[Any])` (function) — Who a DM is with — a DM has no name, and "a direct message" names nothing.
- L366 `_read_channel(caller: McpCaller, arguments: dict[str, Any])` (function)
- L398 `_read_thread(caller: McpCaller, arguments: dict[str, Any])` (function)
- L419 `_search_messages(caller: McpCaller, arguments: dict[str, Any])` (function)
- L458 `_author_id(session: AsyncSession, caller: McpCaller, name: str | None)` (function) — `from:` resolved the way the app resolves it, or a refusal.
- L494 `_channel_names(session: AsyncSession, channel_ids: set[str])` (function)
- L506 `_list_people(caller: McpCaller, arguments: dict[str, Any])` (function)
- L541 `_post_message(caller: McpCaller, arguments: dict[str, Any])` (function)
- L596 `known(name: str)` (function)
- L600 `call(caller: McpCaller, name: str, arguments: dict[str, Any])` (function) — Run one tool. Raises `AppError` for anything the caller did wrong.
