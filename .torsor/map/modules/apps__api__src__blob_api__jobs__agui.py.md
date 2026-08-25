---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T16:15:58'
updated: '2026-08-25T16:15:58'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L50 `Listener` (class)
- L64 `dials_in(self)` (method)
- L68 `runs_here(self)` (method)
- L72 `transport(self)` (method)
- L78 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L130 `stream_run(listener: Listener, run_input: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None=None)` (function) — Call the agent and fold its stream. Returns (fold, messages to post, error).
- L207 `_stream_over_socket(listener: Listener, run_input: dict[str, Any])` (function) — The same run, down a connection the agent opened, from a process that is not this one.
- L254 `_stream_builtin(listener: Listener, run_input: dict[str, Any])` (function) — The same run, against a model, without leaving the process.
- L295 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L356 `_record_error(plugin_id: str, reason: str)` (function)
- L364 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L379 `handle_agui_run(message_id: str)` (function)
- L387 `_run(message_id: str)` (function)
- L445 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str)` (function)
