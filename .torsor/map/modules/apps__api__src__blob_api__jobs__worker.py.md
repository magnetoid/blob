---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L33 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L37 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L41 `agui_run(_ctx: dict[str, Any], message_id: str)` (function) — Answer a mention of an AG-UI app's bot.
- L50 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L76 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L88 `startup(_ctx: dict[str, Any])` (function)
- L94 `shutdown(_ctx: dict[str, Any])` (function)
- L100 `WorkerSettings` (class)
