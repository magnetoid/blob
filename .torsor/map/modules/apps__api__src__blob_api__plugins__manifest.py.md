---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T04:32:20'
updated: '2026-08-22T04:32:20'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L96 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L117 `_check_slug(cls, value: str)` (method)
- L127 `_check_version(cls, value: str)` (method)
- L133 `validate_manifest(manifest: Manifest)` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L163 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
