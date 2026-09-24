---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:19'
updated: '2026-09-23T03:37:19'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L267 `_blank_is_none(cls, value: str | None)` (method)
- L280 `_blank_janus_name_is_default(cls, value: str)` (method)
- L284 `is_prod(self)` (method)
- L288 `is_test(self)` (method)
- L292 `s3_public_endpoint(self)` (method)
- L296 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L308 `agent_shell_enabled(self)` (method) — All four, or off.
- L321 `push_enabled(self)` (method)
- L325 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L336 `get_settings()` (function)
- L343 `served_commit()` (function) — The commit this process serves, normalised, or None when nobody said.
