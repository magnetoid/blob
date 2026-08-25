---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L34 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L38 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L42 `agui_run(_ctx: dict[str, Any], message_id: str)` (function) — Answer a mention of an AG-UI app's bot.
- L51 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L65 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L91 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L103 `startup(_ctx: dict[str, Any])` (function)
- L109 `shutdown(_ctx: dict[str, Any])` (function)
- L115 `WorkerSettings` (class)
