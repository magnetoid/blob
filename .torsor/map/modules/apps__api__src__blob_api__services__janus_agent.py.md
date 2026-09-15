---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T20:04:04'
updated: '2026-09-15T20:04:04'
---

# apps/api/src/blob_api/services/janus_agent.py

Symbols in `apps/api/src/blob_api/services/janus_agent.py`.

- L56 `configured()` (function) — Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
- L62 `manifest()` (function)
- L74 `existing_id(session: AsyncSession, workspace_id: str)` (function) — The row this service owns — never merely a row wearing its slug.
- L112 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install Janus if it is missing, point it at the configured address if it is not,
- L139 `_install(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — A fresh install, or None when the slug is taken by a row that is not ours.
- L169 `_repoint(session: AsyncSession, plugin_id: str)` (function) — Move a row installed earlier onto the configured address and secret.
- L200 `ensure_everywhere()` (function) — Reconcile every workspace at boot. Returns how many gained the agent.
