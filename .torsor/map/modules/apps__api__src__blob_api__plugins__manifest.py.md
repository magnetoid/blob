---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L100 `CommandDecl` (class) — One slash command an app provides.
- L110 `_check_name(cls, value: str)` (method)
- L120 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L145 `_check_slug(cls, value: str)` (method)
- L155 `_check_version(cls, value: str)` (method)
- L161 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset())` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L225 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
