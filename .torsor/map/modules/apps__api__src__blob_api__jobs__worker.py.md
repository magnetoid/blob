---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L41 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L45 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L49 `agui_run(_ctx: dict[str, Any], message_id: str, parent_run_id: str | None=None)` (function) — Answer a mention of an AG-UI app's bot.
- L62 `expire_agent_decisions(_ctx: dict[str, Any])` (function) — Decisions nobody made within their day become `expired`, and their buttons go.
- L69 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L83 `sweep_expired(_ctx: dict[str, Any])` (function)
- L89 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L134 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L146 `sweep_calls(_ctx: dict[str, Any])` (function) — Calls agree with LiveKit: rooms that closed end their call, and who is in a call is
- L154 `startup(_ctx: dict[str, Any])` (function)
- L160 `shutdown(_ctx: dict[str, Any])` (function)
- L168 `after_job_end(ctx: dict[str, Any])` (function) — A line in *our* log after arq has written the result.
- L194 `WorkerSettings` (class)
