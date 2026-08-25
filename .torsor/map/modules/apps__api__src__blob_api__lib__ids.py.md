---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/lib/ids.py

Symbols in `apps/api/src/blob_api/lib/ids.py`.

- L15 `new_id()` (function)
- L19 `is_newer(a: str, b: str | None)` (function) — UUIDv7s compare chronologically as strings, which is why unread math is cheap.
- L26 `new_token(nbytes: int=32)` (function) — URL-safe opaque token for sessions, invites, resets and webhooks.
