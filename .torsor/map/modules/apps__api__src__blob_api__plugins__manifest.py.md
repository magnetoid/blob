---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L111 `CommandDecl` (class) — One slash command an app provides.
- L121 `_check_name(cls, value: str)` (method)
- L131 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L156 `_check_slug(cls, value: str)` (method)
- L164 `_check_version(cls, value: str)` (method)
- L170 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset(), trusted: bool=False)` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L245 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
