---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:09'
updated: '2026-08-26T05:44:09'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L54 `Listener` (class)
- L72 `dials_in(self)` (method)
- L76 `runs_here(self)` (method)
- L80 `transport(self)` (method)
- L86 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L138 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L212 `stream_run(listener: Listener, run_input: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None=None)` (function) — Call the agent and fold its stream. Returns (fold, messages to post, error).
- L289 `_rough_size(event: Mapping[str, Any])` (function) — About how big this event was, without paying to re-serialise it.
- L309 `_stream_over_socket(listener: Listener, run_input: dict[str, Any])` (function) — The same run, down a connection the agent opened, from a process that is not this one.
- L366 `_looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
- L413 `_stream_builtin(listener: Listener, run_input: dict[str, Any])` (function) — The same run, against a model, without leaving the process.
- L458 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L519 `_record_error(plugin_id: str, reason: str)` (function)
- L527 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L542 `handle_agui_run(message_id: str)` (function)
- L550 `_run(message_id: str)` (function)
- L622 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str)` (function)
