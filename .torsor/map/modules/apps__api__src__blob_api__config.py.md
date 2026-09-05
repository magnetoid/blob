---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L189 `_blank_is_none(cls, value: str | None)` (method)
- L193 `is_prod(self)` (method)
- L197 `is_test(self)` (method)
- L201 `s3_public_endpoint(self)` (method)
- L205 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L217 `agent_shell_enabled(self)` (method) — All four, or off.
- L230 `push_enabled(self)` (method)
- L234 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L245 `get_settings()` (function)
