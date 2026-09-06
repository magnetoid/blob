---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T05:53:39'
updated: '2026-09-06T05:53:39'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L39 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L43 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L47 `agui_run(_ctx: dict[str, Any], message_id: str, parent_run_id: str | None=None)` (function) — Answer a mention of an AG-UI app's bot.
- L60 `expire_agent_decisions(_ctx: dict[str, Any])` (function) — Decisions nobody made within their day become `expired`, and their buttons go.
- L67 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L81 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L126 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L138 `startup(_ctx: dict[str, Any])` (function)
- L144 `shutdown(_ctx: dict[str, Any])` (function)
- L152 `WorkerSettings` (class)
