---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/services/workspace_settings.py

Symbols in `apps/api/src/blob_api/services/workspace_settings.py`.

- L28 `TypedSettings` (class)
- L36 `parse(raw: dict[str, Any] | None)` (function)
- L65 `load(workspace_id: str)` (function)
- L76 `load_retention_days()` (function) — The tightest retention across workspaces, for the instance-wide audit sweep.
- L89 `parse_calls(raw: dict[str, Any] | None)` (function) — The `calls` key, typed. A kind whose stored value no longer validates falls back to
- L106 `load_calls(session: AsyncSession, workspace_id: str)` (function) — Inside the caller's transaction, unlike `load`: a start reads the settings it is
