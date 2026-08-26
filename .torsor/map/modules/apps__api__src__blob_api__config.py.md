---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L170 `_blank_is_none(cls, value: str | None)` (method)
- L174 `is_prod(self)` (method)
- L178 `is_test(self)` (method)
- L182 `s3_public_endpoint(self)` (method)
- L186 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L198 `agent_shell_enabled(self)` (method) — All four, or off.
- L211 `push_enabled(self)` (method)
- L215 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L226 `get_settings()` (function)
