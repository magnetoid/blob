---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T04:32:19'
updated: '2026-08-22T04:32:19'
---

# apps/api/src/blob_api/config.py

Symbols in `apps/api/src/blob_api/config.py`.

- L16 `Settings` (class)
- L112 `_blank_is_none(cls, value: str | None)` (method)
- L116 `is_prod(self)` (method)
- L120 `is_test(self)` (method)
- L124 `s3_public_endpoint(self)` (method)
- L128 `agent_hosting_enabled(self)` (method) — Every piece has to be present, or a deploy fails halfway through.
- L140 `push_enabled(self)` (method)
- L144 `sqlalchemy_url(self)` (method) — SQLAlchemy wants the driver named in the scheme; the env carries a plain URL.
- L155 `get_settings()` (function)
