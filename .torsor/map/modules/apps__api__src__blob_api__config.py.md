---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L247 `_blank_is_none(cls, value: str | None)` (method)
- L260 `_blank_janus_name_is_default(cls, value: str)` (method)
- L264 `is_prod(self)` (method)
- L268 `is_test(self)` (method)
- L272 `s3_public_endpoint(self)` (method)
- L276 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L288 `agent_shell_enabled(self)` (method) — All four, or off.
- L301 `push_enabled(self)` (method)
- L305 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L316 `get_settings()` (function)
- L323 `served_commit()` (function) — The commit this process serves, normalised, or None when nobody said.
