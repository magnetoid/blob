---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T16:15:58'
updated: '2026-08-25T16:15:58'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L144 `_blank_is_none(cls, value: str | None)` (method)
- L148 `is_prod(self)` (method)
- L152 `is_test(self)` (method)
- L156 `s3_public_endpoint(self)` (method)
- L160 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L172 `push_enabled(self)` (method)
- L176 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L187 `get_settings()` (function)
