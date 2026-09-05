---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L38 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L42 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L46 `agui_run(_ctx: dict[str, Any], message_id: str, parent_run_id: str | None=None)` (function) — Answer a mention of an AG-UI app's bot.
- L59 `expire_agent_decisions(_ctx: dict[str, Any])` (function) — Decisions nobody made within their day become `expired`, and their buttons go.
- L66 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L80 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L125 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L137 `startup(_ctx: dict[str, Any])` (function)
- L143 `shutdown(_ctx: dict[str, Any])` (function)
- L151 `WorkerSettings` (class)
