---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T02:22:38'
updated: '2026-09-15T02:22:38'
---

# apps/api/src/blob_api/services/janus_agent.py

Symbols in `apps/api/src/blob_api/services/janus_agent.py`.

- L48 `configured()` (function) — Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
- L54 `manifest()` (function)
- L66 `existing_id(session: AsyncSession, workspace_id: str)` (function)
- L76 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install Janus if it is missing. Returns the plugin id, or None when it is not running.
- L106 `ensure_everywhere()` (function) — Reconcile every workspace. Returns how many gained the agent.
