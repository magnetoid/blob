---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T20:16:22'
updated: '2026-08-21T20:16:22'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L93 `_blank_is_none(cls, value: str | None)` (method)
- L97 `is_prod(self)` (method)
- L101 `is_test(self)` (method)
- L105 `s3_public_endpoint(self)` (method)
- L109 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L121 `push_enabled(self)` (method)
- L125 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L136 `get_settings()` (function)
