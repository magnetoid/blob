---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/src/blob_api/lib/net.py

Symbols in `apps/api/src/blob_api/lib/net.py`.

- L21 `is_private_address(address: str)` (function)
- L37 `is_private_host(hostname: str)` (function) — True if any address the name resolves to is one we refuse to reach.
- L47 `check_outbound_url(raw_url: str, *, require_https: bool)` (function) — Validate a URL the server will POST to. Returns a reason to refuse, or None.
