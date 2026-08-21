---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:44:31'
updated: '2026-08-21T06:44:31'
---

# apps/api/src/blob_api/lib/errors.py

Symbols in `apps/api/src/blob_api/lib/errors.py`.

- L10 `AppError` (class)
- L11 `__init__(self, status_code: int, code: str, message: str, field: str | None=None)` (method)
- L19 `bad_request(message: str, code: str='bad_request')` (function) — The request is malformed or fails validation.
- L24 `unauthorized(message: str='Sign in to continue.')` (function) — No valid session.
- L29 `forbidden(message: str="You don't have access to that.")` (function) — Signed in, but not allowed. Also used where existence itself is private.
- L34 `not_found(message: str="That doesn't exist.")` (function)
- L38 `conflict(message: str, code: str='conflict')` (function)
- L42 `too_many_requests(message: str='Too many attempts. Try again shortly.')` (function)
