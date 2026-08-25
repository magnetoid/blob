---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T17:52:26'
updated: '2026-08-25T17:52:26'
---

# apps/api/src/blob_api/jobs/notify.py

Symbols in `apps/api/src/blob_api/jobs/notify.py`.

- L28 `_broadcast_later(user_id: str, state: ReadStateOut)` (function) — Bind the loop variables now, so the after-commit callback sees this pair.
- L37 `_preview(body: str)` (function)
- L42 `handle_notify(message_id: str)` (function)
- L144 `_send_push(subs: Sequence[Any], payload: dict[str, Any])` (function) — Fan out web push, returning subscriptions the browser has thrown away.
