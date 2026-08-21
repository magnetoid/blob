---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T19:34:11'
updated: '2026-08-21T19:34:11'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L88 `_blank_is_none(cls, value: str | None)` (method)
- L92 `is_prod(self)` (method)
- L96 `is_test(self)` (method)
- L100 `s3_public_endpoint(self)` (method)
- L104 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L116 `push_enabled(self)` (method)
- L120 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L131 `get_settings()` (function)
