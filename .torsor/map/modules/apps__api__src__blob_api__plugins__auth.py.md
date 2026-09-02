---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:30'
updated: '2026-09-02T05:36:30'
---

# apps/api/src/blob_api/plugins/auth.py

Symbols in `apps/api/src/blob_api/plugins/auth.py`.

- L33 `BotCaller` (class)
- L42 `has(self, scope: str)` (method)
- L46 `_bearer(request: Request)` (function)
- L55 `current_bot(request: Request)` (function)
- L62 `resolve_bot(token: str)` (function) — Everything `current_bot` does, minus where the token came from.
- L124 `requires(scope: str)` (function) — Dependency asserting one scope: `bot: BotCaller = requires("messages:write")`.
