---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/src/blob_api/services/agent_runs.py

Symbols in `apps/api/src/blob_api/services/agent_runs.py`.

- L28 `Run` (class)
- L44 `start(session: AsyncSession, *, workspace_id: str, plugin_id: str, channel_id: str, thread_root_id: str | None, trigger_message_id: str, trigger_user_id: str | None, transport: str)` (function) — Record that a run began, before the agent is called.
- L88 `finish(session: AsyncSession, run_id: str, *, status: RunStatus, error: str | None=None, post_count: int=0)` (function)
- L109 `list_for_plugin(session: AsyncSession, workspace_id: str, plugin_id: str, limit: int=30)` (function) — One app's runs, newest first.
- L159 `sweep(session: AsyncSession, keep_days: int=30)` (function) — Drop runs older than the window, and give up on ones that never finished.
