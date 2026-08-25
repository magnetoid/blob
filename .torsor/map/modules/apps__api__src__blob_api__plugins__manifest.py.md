---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T10:13:28'
updated: '2026-08-25T10:13:28'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L105 `CommandDecl` (class) — One slash command an app provides.
- L115 `_check_name(cls, value: str)` (method)
- L125 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L150 `_check_slug(cls, value: str)` (method)
- L158 `_check_version(cls, value: str)` (method)
- L164 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset())` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L224 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
