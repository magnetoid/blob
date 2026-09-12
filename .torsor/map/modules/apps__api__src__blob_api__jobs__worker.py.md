---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L40 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L44 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L48 `agui_run(_ctx: dict[str, Any], message_id: str, parent_run_id: str | None=None)` (function) — Answer a mention of an AG-UI app's bot.
- L61 `expire_agent_decisions(_ctx: dict[str, Any])` (function) — Decisions nobody made within their day become `expired`, and their buttons go.
- L68 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L82 `sweep_expired(_ctx: dict[str, Any])` (function)
- L88 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L133 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L145 `startup(_ctx: dict[str, Any])` (function)
- L151 `shutdown(_ctx: dict[str, Any])` (function)
- L159 `after_job_end(ctx: dict[str, Any])` (function) — A line in *our* log after arq has written the result.
- L185 `WorkerSettings` (class)
