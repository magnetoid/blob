---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:42'
updated: '2026-09-04T07:26:42'
---

# apps/api/src/blob_api/main.py

Symbols in `apps/api/src/blob_api/main.py`.

- L52 `_error(status: int, code: str, message: str, field: str | None=None)` (function)
- L59 `is_allowed_origin(origin: str)` (function)
- L71 `SessionMiddleware` (class) — Resolves the session cookie once per request and enforces the public allowlist.
- L78 `__init__(self, app: ASGIApp)` (method)
- L81 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L118 `lifespan(app: FastAPI)` (function)
- L142 `create_app()` (function)
