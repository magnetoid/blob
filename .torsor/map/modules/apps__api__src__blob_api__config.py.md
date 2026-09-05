---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L198 `_blank_is_none(cls, value: str | None)` (method)
- L202 `is_prod(self)` (method)
- L206 `is_test(self)` (method)
- L210 `s3_public_endpoint(self)` (method)
- L214 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L226 `agent_shell_enabled(self)` (method) — All four, or off.
- L239 `push_enabled(self)` (method)
- L243 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L254 `get_settings()` (function)
