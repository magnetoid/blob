---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:54:21'
updated: '2026-09-15T23:54:21'
---

# apps/api/src/blob_api/jobs/agui.py

Symbols in `apps/api/src/blob_api/jobs/agui.py`.

- L48 `_claim(message_id: str)` (function) — Best-effort lease so a duplicate enqueue does not pay for the same run twice.
- L63 `handle_agui_run(message_id: str, parent_run_id: str | None=None)` (function)
- L71 `expire_agent_decisions()` (function) — Decisions nobody made in time: mark the runs, take the buttons off their cards.
- L106 `_run(message_id: str, parent_run_id: str | None=None)` (function)
