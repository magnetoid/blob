---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L58 `_now_iso()` (function)
- L66 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L118 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L192 `agent_tools(listener: Listener, *, workspace_id: str, user_id: str)` (function) — The tools this agent may use, and a runner that runs them as the person who asked.
- L274 `_looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
- L321 `_post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None, run_id: str | None=None, spawn: bool=False)` (function) — One message, the way the bot API posts one. Returns its id, or None if an earlier
- L394 `_record_error(plugin_id: str, reason: str)` (function)
- L402 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L417 `handle_agui_run(message_id: str, parent_run_id: str | None=None)` (function)
- L425 `expire_agent_decisions()` (function) — Decisions nobody made in time: mark the runs, take the buttons off their cards.
- L460 `_run(message_id: str, parent_run_id: str | None=None)` (function)
- L672 `_CardBroadcaster` (class) — Live snapshots of a run's card, at most ~4 a second.
- L681 `__init__(self, run_id: str, channel_id: str, card: run_card.CardFold)` (method)
- L688 `on_event(self, event: Mapping[str, Any])` (method)
- L695 `_flush_loop(self)` (method)
- L711 `stop(self)` (method)
- L719 `_wait_for_cancel(pubsub: Any)` (function) — Returns when a cancel is published for this run. Runs until cancelled itself.
- L734 `_run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str, chain: agent_chains.Chain, max_depth: int, on_behalf_of: str | None)` (function)
