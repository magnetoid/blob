---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L131 `CommandDecl` (class) — One slash command an app provides.
- L141 `_check_name(cls, value: str)` (method)
- L151 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L190 `_check_slug(cls, value: str)` (method)
- L198 `_check_version(cls, value: str)` (method)
- L205 `_check_agui_path(cls, value: str | None)` (method) — A path, and only a path.
- L225 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset(), trusted: bool=False)` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L324 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
