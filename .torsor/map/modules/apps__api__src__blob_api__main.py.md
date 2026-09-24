---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L65 `_error(status: int, code: str, message: str, field: str | None=None, detail: dict[str, Any] | None=None)` (function)
- L82 `is_allowed_origin(origin: str)` (function)
- L94 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L101 `__init__(self, app: ASGIApp)` (method)
- L104 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L141 `lifespan(app: FastAPI)` (function)
- L179 `create_app()` (function)
