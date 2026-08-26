---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:49:02'
updated: '2026-08-26T05:49:02'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L51 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L58 `is_allowed_origin(origin: str)` (function)
- L70 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L77 `__init__(self, app: ASGIApp)` (method)
- L80 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L117 `lifespan(app: FastAPI)` (function)
- L138 `create_app()` (function)
