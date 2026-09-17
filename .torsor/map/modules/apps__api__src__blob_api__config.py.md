---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T23:40:24'
updated: '2026-09-16T23:40:24'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L257 `_blank_is_none(cls, value: str | None)` (method)
- L270 `_blank_janus_name_is_default(cls, value: str)` (method)
- L274 `is_prod(self)` (method)
- L278 `is_test(self)` (method)
- L282 `s3_public_endpoint(self)` (method)
- L286 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L298 `agent_shell_enabled(self)` (method) — All four, or off.
- L311 `push_enabled(self)` (method)
- L315 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L326 `get_settings()` (function)
- L333 `served_commit()` (function) — The commit this process serves, normalised, or None when nobody said.
