---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L125 `_blank_is_none(cls, value: str | None)` (method)
- L129 `is_prod(self)` (method)
- L133 `is_test(self)` (method)
- L137 `s3_public_endpoint(self)` (method)
- L141 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L153 `push_enabled(self)` (method)
- L157 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L168 `get_settings()` (function)
