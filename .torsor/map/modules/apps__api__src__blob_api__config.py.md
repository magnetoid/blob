---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L205 `_blank_is_none(cls, value: str | None)` (method)
- L209 `is_prod(self)` (method)
- L213 `is_test(self)` (method)
- L217 `s3_public_endpoint(self)` (method)
- L221 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L233 `agent_shell_enabled(self)` (method) — All four, or off.
- L246 `push_enabled(self)` (method)
- L250 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L261 `get_settings()` (function)
