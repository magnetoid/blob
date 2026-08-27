---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:41'
updated: '2026-08-27T02:15:41'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L35 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L39 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L43 `agui_run(_ctx: dict[str, Any], message_id: str)` (function) — Answer a mention of an AG-UI app's bot.
- L52 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L66 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L92 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L104 `startup(_ctx: dict[str, Any])` (function)
- L110 `shutdown(_ctx: dict[str, Any])` (function)
- L118 `WorkerSettings` (class)
