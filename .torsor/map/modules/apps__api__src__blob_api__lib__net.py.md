---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T22:36:29'
updated: '2026-08-24T22:36:29'
---

# apps/api/src/blob_api/lib/net.py

Symbols in `apps/api/src/blob_api/lib/net.py`.

- L23 `is_private_address(address: str)` (function)
- L39 `is_private_host(hostname: str)` (function) — True if any address the name resolves to is one we refuse to reach.
- L49 `check_outbound_url(raw_url: str, *, require_https: bool)` (function) — Validate a URL the server will POST to. Returns a reason to refuse, or None.
- L74 `assert_outbound_url(raw_url: str, *, require_https: bool, code: str)` (function) — Refuse a URL the server should not fetch, by raising.
