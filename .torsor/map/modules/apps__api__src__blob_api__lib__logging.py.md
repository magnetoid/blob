---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/lib/logging.py

Symbols in `apps/api/src/blob_api/lib/logging.py`.

- L25 `current_request_id()` (function)
- L29 `RequestIdFilter` (class)
- L30 `filter(self, record: logging.LogRecord)` (method)
- L35 `JsonFormatter` (class)
- L36 `format(self, record: logging.LogRecord)` (method)
- L49 `RequestIdMiddleware` (class) — Stamp every HTTP response with `X-Request-ID`, and bind it for the loggers.
- L58 `__init__(self, app: ASGIApp)` (method)
- L61 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
- L85 `configure()` (function) — Install once. Tests import the app repeatedly; a second call must be a no-op.
