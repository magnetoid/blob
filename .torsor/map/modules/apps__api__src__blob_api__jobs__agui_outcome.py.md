---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T01:33:41'
updated: '2026-09-13T01:33:41'
---

# apps/api/src/blob_api/jobs/agui_outcome.py

Symbols in `apps/api/src/blob_api/jobs/agui_outcome.py`.

- L49 `now_iso()` (function)
- L55 `refused_view(run_id: str, listener: Listener, *, channel_id: str, thread_root_id: str | None, trigger_id: str, reason: str)` (function) — A run that was over before it began, as the client draws it.
- L93 `refuse(session: AsyncSession, after: Any, listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, reason: str)` (function) — Record that this agent was not run, and show the card that says so.
- L129 `Gathered` (class) — What one run will be shown, read in one session and closed before the call.
- L146 `Streamed` (class)
- L153 `post_as_bot(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, body: str, client_msg_id: str, blocks: list[dict[str, Any]] | None, run_id: str | None=None, spawn: bool=False)` (function) — One message, the way the bot API posts one. Returns its id, or None if an earlier
- L226 `record_error(plugin_id: str, reason: str)` (function)
- L234 `_gather(listener: Listener, *, channel_id: str, thread_root_id: str | None, chain: agent_chains.Chain)` (function)
- L302 `_start(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, chain: agent_chains.Chain)` (function) — The `running` row, written before the call and not after.
- L358 `_stream(listener: Listener, run_input: Any, *, run_id: str, workspace_id: str, channel_id: str, thread_root_id: str | None, chain: agent_chains.Chain, card: run_card.CardFold)` (function) — Run the agent under the Stop button, showing the card as it forms.
- L438 `_finish(listener: Listener, streamed: Streamed, *, run_id: str, workspace_id: str, channel_id: str, thread_root_id: str | None, thread_key: str, card: run_card.CardFold, post_count: int)` (function) — How the run ended, on the row and on the channel.
- L566 `run_one(listener: Listener, *, workspace_id: str, channel_id: str, thread_root_id: str | None, trigger_id: str, trigger_user_id: str | None, asker: str, channel_name: str, chain: agent_chains.Chain, max_depth: int, on_behalf_of: str | None)` (function)
