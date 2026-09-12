---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L224 `_blank_is_none(cls, value: str | None)` (method)
- L228 `is_prod(self)` (method)
- L232 `is_test(self)` (method)
- L236 `s3_public_endpoint(self)` (method)
- L240 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L252 `agent_shell_enabled(self)` (method) — All four, or off.
- L265 `push_enabled(self)` (method)
- L269 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L280 `get_settings()` (function)
