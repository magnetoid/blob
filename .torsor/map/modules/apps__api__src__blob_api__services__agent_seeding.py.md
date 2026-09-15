---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/services/agent_seeding.py

Symbols in `apps/api/src/blob_api/services/agent_seeding.py`.

- L25 `Ensure` (class) — A seeder's "make sure" for one workspace.
- L32 `__call__(self, session: AsyncSession, workspace_id: str, /, *, installed_by: str)` (method)
- L41 `join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str)` (function) — Every public channel the bot is not already in.
- L88 `reconcile_everywhere(what: str, *, existing_id: Lookup, ensure: Ensure, lacking_slug: str | None=None)` (function) — Run one seeder over every workspace. Returns how many gained the agent.
