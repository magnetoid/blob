---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/schemas/base.py

Symbols in `apps/api/src/blob_api/schemas/base.py`.

- L16 `CamelModel` (class)
- L26 `OkOut` (class) — The answer to a request that has nothing to say beyond "done".
- L37 `iso(value: datetime | str | None)` (function) — Serialize a timestamp the way the client already expects.
- L52 `require_iso(value: datetime | str)` (function)
- L58 `unwrap(row: Any, key: str, default: Any=None)` (function) — Read a column from a SQLAlchemy Row or a mapping, whichever a caller passes.
