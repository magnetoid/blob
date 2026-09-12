---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/lib/magic.py

Symbols in `apps/api/src/blob_api/lib/magic.py`.

- L29 `sniff(header: bytes)` (function) — The type the bytes themselves are, or None when we do not have a signature.
- L52 `claimed_mime(raw: str)` (function)
- L56 `reject_reason(header: bytes, mime: str)` (function) — Why this upload must not complete, or None when the bytes are acceptable.
