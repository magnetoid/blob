---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/services/agent_runs.py

Symbols in `apps/api/src/blob_api/services/agent_runs.py`.

- L30 `Run` (class)
- L46 `start(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str)` (function) — Record that a run began, before the agent is called.
- L90 `finish(session: AsyncSession, run_id: str, *, status: RunStatus, error: str | None=None, post_count: int=0, card: dict[str, Any] | None=None)` (function)
- L119 `list_for_plugin(session: AsyncSession, workspace_id: str, plugin_id: str, limit: int=30)` (function) — One app's runs, newest first.
- L167 `sweep(session: AsyncSession, keep_days: int=30)` (function) — Drop runs older than the window, and give up on ones that never finished.
- L202 `views_for_channel(session: AsyncSession, *, workspace_id: str, channel_id: str, limit: int=10)` (function) — The runs a conversation view renders on load — live ones plus the recent tail.
- L248 `request_cancel(session: AsyncSession, *, workspace_id: str, run_id: str)` (function) — Mark the ask durable and return what the publisher needs, or None if no such
