---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T06:48:47'
updated: '2026-09-02T06:48:47'
---

# apps/api/src/blob_api/services/agent_runs.py

Symbols in `apps/api/src/blob_api/services/agent_runs.py`.

- L30 `Run` (class)
- L46 `start(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str)` (function) — Record that a run began, before the agent is called.
- L90 `check_budget(session: AsyncSession, *, plugin_id: str)` (function) — The reason this run must not start, or None.
- L144 `record_refusal(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str, reason: str)` (function) — A run that was never allowed to begin, written down anyway.
- L191 `usage_by_plugin(session: AsyncSession, plugin_ids: list[str])` (function) — Trailing-day (runs, seconds) per plugin, for the console list. One statement.
- L216 `finish(session: AsyncSession, run_id: str, *, status: RunStatus, error: str | None=None, post_count: int=0, card: dict[str, Any] | None=None)` (function)
- L245 `list_for_plugin(session: AsyncSession, workspace_id: str, plugin_id: str, limit: int=30)` (function) — One app's runs, newest first.
- L293 `sweep(session: AsyncSession, keep_days: int=30)` (function) — Drop runs older than the window, and give up on ones that never finished.
- L328 `views_for_channel(session: AsyncSession, *, workspace_id: str, channel_id: str, limit: int=10)` (function) — The runs a conversation view renders on load — live ones plus the recent tail.
- L374 `request_cancel(session: AsyncSession, *, workspace_id: str, run_id: str)` (function) — Mark the ask durable and return what the publisher needs, or None if no such
