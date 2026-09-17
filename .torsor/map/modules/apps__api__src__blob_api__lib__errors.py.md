---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T23:40:24'
updated: '2026-09-16T23:40:24'
---

# apps/api/src/blob_api/lib/errors.py

Symbols in `apps/api/src/blob_api/lib/errors.py`.

- L12 `AppError` (class)
- L13 `__init__(self, status_code: int, code: str, message: str, field: str | None=None, detail: dict[str, Any] | None=None)` (method)
- L35 `unique_violation(exc: Exception)` (function) — True when a write lost a race against a unique index.
- L46 `bad_request(message: str, code: str='bad_request', detail: dict[str, Any] | None=None)` (function) — The request is malformed or fails validation.
- L53 `unauthorized(message: str='Sign in to continue.')` (function) — No valid session.
- L58 `forbidden(message: str="You don't have access to that.")` (function) — Signed in, but not allowed. Also used where existence itself is private.
- L63 `not_found(message: str="That doesn't exist.")` (function)
- L67 `conflict(message: str, code: str='conflict')` (function)
- L71 `too_many_requests(message: str='Too many attempts. Try again shortly.')` (function)
- L79 `message_gone()` (function)
- L83 `channel_gone()` (function)
- L87 `thread_gone()` (function)
- L91 `no_such_person()` (function)
- L95 `no_such_group()` (function)
- L99 `no_such_file()` (function)
