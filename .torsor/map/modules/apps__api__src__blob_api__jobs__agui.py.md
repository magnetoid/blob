---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L48 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L100 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L175 `_looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
- L222 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L283 `_record_error(plugin_id: str, reason: str)` (function)
- L291 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L306 `handle_agui_run(message_id: str)` (function)
- L314 `_run(message_id: str)` (function)
- L395 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str)` (function)
