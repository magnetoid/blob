---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/services/workspace_agent.py

Symbols in `apps/api/src/blob_api/services/workspace_agent.py`.

- L58 `manifest()` (function)
- L69 `existing_id(session: AsyncSession, workspace_id: str)` (function)
- L84 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install the workspace agent if it is missing, and put it in the public channels.
- L123 `_join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel it is not already in.
- L150 `ensure_everywhere()` (function) — Reconcile every workspace. Returns how many gained an agent.
