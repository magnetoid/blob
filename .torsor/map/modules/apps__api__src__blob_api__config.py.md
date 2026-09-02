---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:26:05'
updated: '2026-09-02T04:26:05'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L175 `_blank_is_none(cls, value: str | None)` (method)
- L179 `is_prod(self)` (method)
- L183 `is_test(self)` (method)
- L187 `s3_public_endpoint(self)` (method)
- L191 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L203 `agent_shell_enabled(self)` (method) — All four, or off.
- L216 `push_enabled(self)` (method)
- L220 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L231 `get_settings()` (function)
