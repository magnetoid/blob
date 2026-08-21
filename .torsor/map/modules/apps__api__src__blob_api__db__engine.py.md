---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:49:12'
updated: '2026-08-21T07:49:12'
---

# apps/api/src/blob_api/db/engine.py

Symbols in `apps/api/src/blob_api/db/engine.py`.

- L36 `_register_codecs(dbapi_connection: Any, _record: Any)` (function) — Return uuid columns as strings.
- L57 `AfterCommit` (class) — Collects callbacks to run once the surrounding transaction has committed.
- L60 `__init__(self)` (method)
- L63 `add(self, fn: Callable[[], Any])` (method)
- L66 `drain(self)` (method)
- L73 `transaction()` (function) — Run work in a transaction; broadcast only after it commits.
- L87 `session_scope()` (function) — A read-only session for handlers that do not write.
- L93 `fetch_all(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function) — Run hand-written SQL. The chat queries stay verbatim rather than being
- L102 `fetch_one(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function)
- L109 `execute(session: AsyncSession, sql: str, params: dict[str, Any] | None=None)` (function)
- L113 `close_engine()` (function)
