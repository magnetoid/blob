---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:50'
updated: '2026-09-04T17:42:50'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L49 `_now_iso()` (function)
- L57 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L109 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L184 `_looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
- L231 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None)` (function) — One message, the way the bot API posts one.
- L292 `_record_error(plugin_id: str, reason: str)` (function)
- L300 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L315 `handle_agui_run(message_id: str)` (function)
- L323 `_run(message_id: str)` (function)
- L431 `_CardBroadcaster` (class) — Live snapshots of a run's card, at most ~4 a second.
- L440 `__init__(self, run_id: str, channel_id: str, card: run_card.CardFold)` (method)
- L447 `on_event(self, event: Mapping[str, Any])` (method)
- L454 `_flush_loop(self)` (method)
- L470 `stop(self)` (method)
- L478 `_wait_for_cancel(pubsub: Any)` (function) — Returns when a cancel is published for this run. Runs until cancelled itself.
- L493 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str)` (function)
