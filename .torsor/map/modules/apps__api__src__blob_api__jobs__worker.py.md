---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:41'
updated: '2026-09-04T07:26:41'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L37 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L41 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L45 `agui_run(_ctx: dict[str, Any], message_id: str)` (function) — Answer a mention of an AG-UI app's bot.
- L54 `sweep_agent_runs(_ctx: dict[str, Any])` (function) — Retention for the agent run log.
- L68 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L113 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L125 `startup(_ctx: dict[str, Any])` (function)
- L131 `shutdown(_ctx: dict[str, Any])` (function)
- L139 `WorkerSettings` (class)
