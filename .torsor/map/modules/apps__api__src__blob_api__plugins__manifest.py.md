---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/plugins/manifest.py

Symbols in `apps/api/src/blob_api/plugins/manifest.py`.

- L80 `Manifest` (class) — The registration payload. Also the shape a local plugin's `plugin.toml` parses to.
- L95 `_check_slug(cls, value: str)` (method)
- L105 `_check_version(cls, value: str)` (method)
- L111 `validate_manifest(manifest: Manifest)` (function) — Reject what would otherwise fail later, at delivery time, in a background job.
- L138 `new_scopes(previous: list[str], requested: list[str])` (function) — Scopes an update asks for that were not already granted.
