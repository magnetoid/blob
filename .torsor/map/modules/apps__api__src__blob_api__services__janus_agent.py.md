---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/services/janus_agent.py

Symbols in `apps/api/src/blob_api/services/janus_agent.py`.

- L54 `configured()` (function) — Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
- L60 `manifest()` (function)
- L72 `existing_id(session: AsyncSession, workspace_id: str)` (function) — The row this service owns — never merely a row wearing its slug.
- L109 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install Janus if it is missing, point it at the configured address if it is not,
- L136 `_install(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — A fresh install, or None when the slug is taken by a row that is not ours.
- L168 `_repoint(session: AsyncSession, plugin_id: str)` (function) — Move a row installed earlier onto the configured address and secret.
- L199 `ensure_everywhere()` (function) — Reconcile every workspace at boot. Returns how many gained the agent.
