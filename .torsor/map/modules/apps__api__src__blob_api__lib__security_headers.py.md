---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/lib/security_headers.py

Symbols in `apps/api/src/blob_api/lib/security_headers.py`.

- L57 `_origin(url: str | None)` (function) — `scheme://host[:port]` of a URL, or None if it has no host.
- L67 `_socket_origin(public_url: str)` (function)
- L75 `content_security_policy(*, public_url: str, storage_origin: str | None, extra_sources: Iterable[str]=())` (function) — The policy for the app and the API, as one string.
- L115 `security_headers(*, path: str, secure: bool, existing: MutableHeaders)` (function) — What to add to a response, given what it already carries.
- L137 `SecurityHeadersMiddleware` (class) — Pure ASGI, for the same reason `SessionMiddleware` is: `BaseHTTPMiddleware`
- L141 `__init__(self, app: ASGIApp)` (method)
- L144 `__call__(self, scope: Scope, receive: Receive, send: Send)` (method)
