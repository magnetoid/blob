---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:40'
updated: '2026-09-02T05:04:40'
---

# apps/api/src/blob_api/jobs/reminders.py

Symbols in `apps/api/src/blob_api/jobs/reminders.py`.

- L32 `fire_reminders(_ctx: dict[str, Any])` (function)
- L82 `_deliver_later(user_id: str, event: dict[str, Any], note: str | None)` (function) — Bind the loop variables now, so the after-commit callback sees this row's.
- L92 `_push_reminder(user_id: str, note: str | None)` (function) — The push half, outside every transaction — it is a fan-out of remote calls.
