---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L50 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L57 `is_allowed_origin(origin: str)` (function)
- L69 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L76 `__init__(self, app: ASGIApp)` (method)
- L79 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L116 `lifespan(app: FastAPI)` (function)
- L125 `create_app()` (function)
