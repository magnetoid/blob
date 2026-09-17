---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T04:36:24'
updated: '2026-09-17T04:36:24'
---

# apps/api/src/blob_api/services/janus_agent.py

Symbols in `apps/api/src/blob_api/services/janus_agent.py`.

- L55 `configured()` (function) — Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
- L61 `manifest()` (function)
- L73 `existing_id(session: AsyncSession, workspace_id: str)` (function) — The row this service owns — never merely a row wearing its slug.
- L109 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install Janus if it is missing, point it at the configured address if it is not,
- L144 `_wants_every_public_channel(session: AsyncSession, plugin_id: str)` (function) — The switch as the workspace last left it — `POST /api/admin/plugins/{id}/everywhere`.
- L155 `_install(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — A fresh install, or None when the slug is taken by a row that is not ours.
- L187 `_repoint(session: AsyncSession, plugin_id: str)` (function) — Move a row installed earlier onto the configured address and secret.
- L218 `join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel the bot is not already in.
- L265 `ensure_everywhere()` (function) — Reconcile every workspace at boot. Returns how many gained the agent.
