---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T04:30:13'
updated: '2026-08-25T04:30:13'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L48 `Listener` (class)
- L59 `dials_in(self)` (method)
- L63 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L113 `stream_run(listener: Listener, run_input: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None=None)` (function) — Call the agent and fold its stream. Returns (fold, messages to post, error).
- L188 `_stream_over_socket(listener: Listener, run_input: dict[str, Any])` (function) — The same run, down a connection the agent opened, from a process that is not this one.
- L235 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L296 `_record_error(plugin_id: str, reason: str)` (function)
- L304 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L319 `handle_agui_run(message_id: str)` (function)
- L327 `_run(message_id: str)` (function)
- L384 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, asker: str, channel_name: str)` (function)
