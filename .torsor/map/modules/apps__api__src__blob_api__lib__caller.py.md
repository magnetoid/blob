---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/lib/caller.py

Symbols in `apps/api/src/blob_api/lib/caller.py`.

- L49 `forwarded_for(connection: HTTPConnection)` (function)
- L54 `client_ip(connection: HTTPConnection)` (function) — The caller's address, or None when nothing trustworthy names one.
- L73 `_an_address(value: str | None)` (function) — An address, or nothing.
- L90 `client_key(connection: HTTPConnection)` (function) — The same address, as a rate-limit key that is never empty.
