---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/services/agent_runs.py

Symbols in `apps/api/src/blob_api/services/agent_runs.py`.

- L32 `Run` (class)
- L52 `start(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str, chain_id: str, initiated_by_user_id: str | None, parent_run_id: str | None=None, depth: int=0)` (function) — Record that a run began, before the agent is called.
- L110 `check_budget(session: AsyncSession, *, plugin_id: str)` (function) — The reason this run must not start, or None.
- L164 `record_refusal(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str, reason: str)` (function) — A run that was never allowed to begin, written down anyway.
- L213 `usage_by_plugin(session: AsyncSession, plugin_ids: list[str])` (function) — Trailing-day (runs, seconds) per plugin, for the console list. One statement.
- L238 `finish(session: AsyncSession, run_id: str, *, status: RunStatus, error: str | None=None, post_count: int=0, card: dict[str, Any] | None=None, interrupt: list[dict[str, Any]] | None=None, state_json: str | None=None, expires_at: Any | None=None)` (function) — Close the row. For an interrupted run, also keep what a resume will need.
- L283 `set_decision_message(session: AsyncSession, run_id: str, message_id: str)` (function) — Remember which message carries the buttons, so answering can settle it.
- L291 `request_cancel_descendants(session: AsyncSession, *, workspace_id: str, run_id: str)` (function) — Stop pressed on a run stops the hops it caused, too.
- L322 `expire_waiting(session: AsyncSession)` (function) — Decisions nobody made in time. Returns what the caller needs to settle their cards.
- L355 `list_for_plugin(session: AsyncSession, workspace_id: str, plugin_id: str, limit: int=30)` (function) — One app's runs, newest first.
- L408 `sweep(session: AsyncSession, keep_days: int=30)` (function) — Drop runs older than the window, and give up on ones that never finished.
- L456 `_view(row: Any)` (function)
- L479 `views_for_channel(session: AsyncSession, *, workspace_id: str, channel_id: str, limit: int=10)` (function) — The runs a conversation view renders on load — live ones plus the recent tail.
- L511 `view_of(session: AsyncSession, run_id: str)` (function) — One run in the wire shape, for re-announcing it after its state changed.
- L519 `request_cancel(session: AsyncSession, *, workspace_id: str, run_id: str)` (function) — Mark the ask durable and return what the publisher needs, or None if no such
