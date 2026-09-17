---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T23:40:24'
updated: '2026-09-16T23:40:24'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L63 `_error(status: int, code: str, message: str, field: str | None=None, detail: dict[str, Any] | None=None)` (function)
- L80 `is_allowed_origin(origin: str)` (function)
- L92 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L99 `__init__(self, app: ASGIApp)` (method)
- L102 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L139 `lifespan(app: FastAPI)` (function)
- L177 `create_app()` (function)
