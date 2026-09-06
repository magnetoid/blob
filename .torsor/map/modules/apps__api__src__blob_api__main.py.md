---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L61 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L68 `is_allowed_origin(origin: str)` (function)
- L80 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L87 `__init__(self, app: ASGIApp)` (method)
- L90 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L127 `lifespan(app: FastAPI)` (function)
- L168 `create_app()` (function)
