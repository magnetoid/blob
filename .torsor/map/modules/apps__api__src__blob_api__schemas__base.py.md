---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:44:31'
updated: '2026-08-21T06:44:31'
---

# apps/api/src/blob_api/schemas/base.py

Symbols in `apps/api/src/blob_api/schemas/base.py`.

- L16 `CamelModel` (class)
- L26 `iso(value: datetime | str | None)` (function) — Serialize a timestamp the way the client already expects.
- L41 `require_iso(value: datetime | str)` (function)
- L47 `unwrap(row: Any, key: str, default: Any=None)` (function) — Read a column from a SQLAlchemy Row or a mapping, whichever a caller passes.
