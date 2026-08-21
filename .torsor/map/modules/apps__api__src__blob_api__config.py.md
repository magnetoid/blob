---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T01:05:35'
updated: '2026-08-22T01:05:35'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L99 `_blank_is_none(cls, value: str | None)` (method)
- L103 `is_prod(self)` (method)
- L107 `is_test(self)` (method)
- L111 `s3_public_endpoint(self)` (method)
- L115 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L127 `push_enabled(self)` (method)
- L131 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L142 `get_settings()` (function)
