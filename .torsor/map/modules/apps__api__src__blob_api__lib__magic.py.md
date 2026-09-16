---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/lib/magic.py

Symbols in `apps/api/src/blob_api/lib/magic.py`.

- L47 `sniff(header: bytes)` (function) — The type the bytes themselves are, or None when we do not have a signature.
- L85 `claimed_mime(raw: str)` (function)
- L89 `reject_reason(header: bytes, mime: str)` (function) — Why this upload must not complete, or None when the bytes are acceptable.
