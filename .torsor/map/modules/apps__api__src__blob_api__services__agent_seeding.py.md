---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T20:04:04'
updated: '2026-09-15T20:04:04'
---

# apps/api/src/blob_api/services/agent_seeding.py

Symbols in `apps/api/src/blob_api/services/agent_seeding.py`.

- L26 `Ensure` (class) — A seeder's "make sure" for one workspace.
- L33 `__call__(self, session: AsyncSession, workspace_id: str, /, *, installed_by: str)` (method)
- L42 `join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel the bot is not already in.
- L84 `reconcile_everywhere(what: str, *, existing_id: Lookup, ensure: Ensure, lacking_slug: str | None=None)` (function) — Run one seeder over every workspace. Returns how many gained the agent.
