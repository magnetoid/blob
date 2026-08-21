---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:24:31'
updated: '2026-08-21T07:24:31'
---

# apps/api/src/blob_api/jobs/worker.py

Symbols in `apps/api/src/blob_api/jobs/worker.py`.

- L32 `notify(_ctx: dict[str, Any], message_id: str)` (function)
- L36 `unfurl(_ctx: dict[str, Any], message_id: str)` (function)
- L40 `sweep_orphans(_ctx: dict[str, Any])` (function) — Uploads that were started but never attached to a message.
- L66 `deliver_plugin_events(_ctx: dict[str, Any])` (function) — Drain the plugin outbox.
- L78 `startup(_ctx: dict[str, Any])` (function)
- L84 `shutdown(_ctx: dict[str, Any])` (function)
- L90 `WorkerSettings` (class)
