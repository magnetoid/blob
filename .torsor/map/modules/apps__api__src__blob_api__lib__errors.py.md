---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T22:01:13'
updated: '2026-08-24T22:01:13'
---

# apps/api/src/blob_api/lib/errors.py

Symbols in `apps/api/src/blob_api/lib/errors.py`.

- L10 `AppError` (class)
- L11 `__init__(self, status_code: int, code: str, message: str, field: str | None=None)` (method)
- L19 `unique_violation(exc: Exception)` (function) — True when a write lost a race against a unique index.
- L30 `bad_request(message: str, code: str='bad_request')` (function) — The request is malformed or fails validation.
- L35 `unauthorized(message: str='Sign in to continue.')` (function) — No valid session.
- L40 `forbidden(message: str="You don't have access to that.")` (function) — Signed in, but not allowed. Also used where existence itself is private.
- L45 `not_found(message: str="That doesn't exist.")` (function)
- L49 `conflict(message: str, code: str='conflict')` (function)
- L53 `too_many_requests(message: str='Too many attempts. Try again shortly.')` (function)
