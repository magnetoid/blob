---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L48 `_now_iso()` (function)
- L56 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L108 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L183 `_looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
- L230 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L291 `_record_error(plugin_id: str, reason: str)` (function)
- L299 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L314 `handle_agui_run(message_id: str)` (function)
- L322 `_run(message_id: str)` (function)
- L403 `_CardBroadcaster` (class) — Live snapshots of a run's card, at most ~4 a second.
- L412 `__init__(self, run_id: str, channel_id: str, card: run_card.CardFold)` (method)
- L419 `on_event(self, event: Mapping[str, Any])` (method)
- L426 `_flush_loop(self)` (method)
- L442 `stop(self)` (method)
- L450 `_wait_for_cancel(pubsub: Any)` (function) — Returns when a cancel is published for this run. Runs until cancelled itself.
- L465 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str)` (function)
