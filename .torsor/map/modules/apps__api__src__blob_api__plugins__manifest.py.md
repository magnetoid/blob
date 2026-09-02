---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:30'
updated: '2026-09-02T05:36:30'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L124 `CommandDecl` (class) — One slash command an app provides.
- L134 `_check_name(cls, value: str)` (method)
- L144 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L183 `_check_slug(cls, value: str)` (method)
- L191 `_check_version(cls, value: str)` (method)
- L198 `_check_agui_path(cls, value: str | None)` (method) — A path, and only a path.
- L218 `validate_manifest(manifest: Manifest, *, reserved_commands: frozenset[str]=frozenset(), trusted: bool=False)` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L317 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
