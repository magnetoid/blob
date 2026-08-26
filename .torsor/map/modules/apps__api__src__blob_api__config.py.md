---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:49:02'
updated: '2026-08-26T05:49:02'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L171 `_blank_is_none(cls, value: str | None)` (method)
- L175 `is_prod(self)` (method)
- L179 `is_test(self)` (method)
- L183 `s3_public_endpoint(self)` (method)
- L187 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L199 `agent_shell_enabled(self)` (method) — All four, or off.
- L212 `push_enabled(self)` (method)
- L216 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L227 `get_settings()` (function)
