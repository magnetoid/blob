---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/lib/caller.py

Symbols in `apps/api/src/blob_api/lib/caller.py`.

- L49 `forwarded_for(connection: HTTPConnection)` (function)
- L54 `client_ip(connection: HTTPConnection)` (function) — The caller's address, or None when nothing trustworthy names one.
- L73 `_an_address(value: str | None)` (function) — An address, or nothing.
- L90 `client_key(connection: HTTPConnection)` (function) — The same address, as a rate-limit key that is never empty.
