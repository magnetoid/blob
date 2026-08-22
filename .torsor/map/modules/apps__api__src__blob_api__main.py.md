---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T02:53:13'
updated: '2026-08-22T02:53:13'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L49 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L56 `is_allowed_origin(origin: str)` (function)
- L68 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L75 `__init__(self, app: ASGIApp)` (method)
- L78 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L115 `lifespan(app: FastAPI)` (function)
- L123 `create_app()` (function)
