---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T20:04:04'
updated: '2026-09-15T20:04:04'
---

# apps/api/src/blob_api/services/workspace_agent.py

Symbols in `apps/api/src/blob_api/services/workspace_agent.py`.

- L56 `manifest()` (function)
- L67 `existing_id(session: AsyncSession, workspace_id: str)` (function)
- L82 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install the workspace agent if it is missing, and put it in the public channels.
- L112 `ensure_everywhere()` (function) — Reconcile every workspace at boot. Returns how many gained an agent.
