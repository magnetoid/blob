---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/janus_agent.py

Symbols in `apps/api/src/blob_api/services/janus_agent.py`.

- L52 `configured()` (function) — Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
- L58 `manifest()` (function)
- L70 `existing_id(session: AsyncSession, workspace_id: str)` (function) — The row this service owns — never merely a row wearing its slug.
- L107 `ensure(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — Install Janus if it is missing, point it at the configured address if it is not,
- L134 `_install(session: AsyncSession, workspace_id: str, *, installed_by: str)` (function) — A fresh install, or None when the slug is taken by a row that is not ours.
- L166 `_repoint(session: AsyncSession, plugin_id: str)` (function) — Move a row installed earlier onto the configured address and secret.
- L197 `join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel the bot is not already in.
- L244 `ensure_everywhere()` (function) — Reconcile every workspace at boot. Returns how many gained the agent.
