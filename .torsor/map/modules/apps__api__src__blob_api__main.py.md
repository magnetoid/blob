---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L53 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L60 `is_allowed_origin(origin: str)` (function)
- L72 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L79 `__init__(self, app: ASGIApp)` (method)
- L82 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L119 `lifespan(app: FastAPI)` (function)
- L143 `create_app()` (function)
