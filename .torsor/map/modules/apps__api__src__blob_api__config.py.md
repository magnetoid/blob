---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:41'
updated: '2026-09-04T07:26:41'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L185 `_blank_is_none(cls, value: str | None)` (method)
- L189 `is_prod(self)` (method)
- L193 `is_test(self)` (method)
- L197 `s3_public_endpoint(self)` (method)
- L201 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L213 `agent_shell_enabled(self)` (method) — All four, or off.
- L226 `push_enabled(self)` (method)
- L230 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L241 `get_settings()` (function)
