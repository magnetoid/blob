---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/services/mcp.py

Symbols in `apps/api/src/blob_api/services/mcp.py`.

- L65 `McpCaller` (class) — The person an assistant is acting as.
- L86 `may_write(self)` (method)
- L90 `resolve_token(token: str)` (function) — The caller a bearer token names, or None. Never raises for a bad token.
- L291 `catalogue(caller: McpCaller)` (function) — The tools this token may call, in the shape `tools/list` returns.
- L322 `tools_for_agent(scopes: frozenset[str])` (function) — The same tools, offered to an agent, in the shape the model layer takes.
- L350 `_when(value: str | None)` (function) — An ISO timestamp as something a model reads without arithmetic.
- L361 `_names(session: AsyncSession, user_ids: set[str])` (function)
- L373 `_body(message: Message)` (function)
- L390 `_transcript(messages: list[Message], names: dict[str, str])` (function)
- L398 `_limit(arguments: dict[str, Any])` (function)
- L407 `_required(arguments: dict[str, Any], key: str)` (function)
- L414 `_an_id(value: str, what: str)` (function) — An id, checked here rather than by Postgres.
- L427 `_resolve_channel(session: AsyncSession, caller: McpCaller, reference: str)` (function) — A channel id, or a #name. Names are what a person types at their assistant.
- L457 `_channel_label(name: str | None, kind: str)` (function)
- L468 `_whoami(caller: McpCaller, _arguments: dict[str, Any])` (function)
- L478 `_list_channels(caller: McpCaller, arguments: dict[str, Any])` (function)
- L512 `_dm_names(session: AsyncSession, caller: McpCaller, channels: list[Any])` (function) — Who a DM is with — a DM has no name, and "a direct message" names nothing.
- L539 `_read_channel(caller: McpCaller, arguments: dict[str, Any])` (function)
- L571 `_read_thread(caller: McpCaller, arguments: dict[str, Any])` (function)
- L591 `_search_messages(caller: McpCaller, arguments: dict[str, Any])` (function)
- L626 `_author_id(session: AsyncSession, caller: McpCaller, name: str | None)` (function) — `from:` resolved the way the app resolves it, or a refusal.
- L662 `_channel_names(session: AsyncSession, channel_ids: set[str])` (function)
- L674 `_list_people(caller: McpCaller, arguments: dict[str, Any])` (function)
- L709 `_post_message(caller: McpCaller, arguments: dict[str, Any])` (function)
- L764 `known(name: str)` (function)
- L768 `call(caller: McpCaller, name: str, arguments: dict[str, Any])` (function) — Run one tool. Raises `AppError` for anything the caller did wrong.
