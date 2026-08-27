---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/services/workspace_agent.py

Symbols in `apps/api/src/blob_api/services/workspace_agent.py`.

- L52 `manifest()` (function)
- L63 `existing_id(session: AsyncSession, workspace_id: str)` (function)
- L78 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install the workspace agent if it is missing, and put it in the public channels.
- L117 `_join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel it is not already in.
- L144 `ensure_everywhere()` (function) — Reconcile every workspace. Returns how many gained an agent.
