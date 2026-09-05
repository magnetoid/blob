---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/db/engine.py

Symbols in `apps/api/src/blob_api/db/engine.py`.

- L37 `_register_codecs(dbapi_connection: Any, _record: Any)` (function) — Return uuid columns as strings.
- L60 `AfterCommit` (class) — Collects callbacks to run once the surrounding transaction has committed.
- L63 `__init__(self)` (method)
- L66 `add(self, fn: Callable[[], Any])` (method)
- L69 `drain(self)` (method)
- L82 `transaction()` (function) — Run work in a transaction; broadcast only after it commits.
- L96 `session_scope()` (function) — A read-only session for handlers that do not write.
- L102 `fetch_all(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function) — Run hand-written SQL. The chat queries stay verbatim rather than being
- L111 `fetch_one(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function)
- L118 `execute(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function)
- L122 `close_engine()` (function)
