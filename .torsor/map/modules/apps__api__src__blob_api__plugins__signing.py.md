---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:50'
updated: '2026-09-04T17:42:50'
---

# apps/api/src/blob_api/plugins/signing.py

Symbols in `apps/api/src/blob_api/plugins/signing.py`.

- L31 `new_secret()` (function) — A signing secret. Shown once at install and never recoverable afterwards.
- L36 `sign(secret: str, timestamp: int, body: bytes)` (function)
- L42 `verify(secret: str, timestamp: str | None, signature: str | None, body: bytes)` (function) — Constant-time check of a signature we received.
