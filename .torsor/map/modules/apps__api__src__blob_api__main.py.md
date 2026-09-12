---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L63 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L70 `is_allowed_origin(origin: str)` (function)
- L82 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L89 `__init__(self, app: ASGIApp)` (method)
- L92 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L129 `lifespan(app: FastAPI)` (function)
- L170 `create_app()` (function)
