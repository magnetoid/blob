---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L125 `CommandDecl` (class) — One slash command an app provides.
- L135 `_check_name(cls, value: str)` (method)
- L145 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L184 `_check_slug(cls, value: str)` (method)
- L192 `_check_version(cls, value: str)` (method)
- L199 `_check_agui_path(cls, value: str | None)` (method) — A path, and only a path.
- L219 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset())` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L305 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
