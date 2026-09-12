---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T00:18:00'
updated: '2026-09-13T00:18:00'
---

# apps/api/src/blob_api/services/my_agents.py

Symbols in `apps/api/src/blob_api/services/my_agents.py`.

- L28 `available(session: AsyncSession, user: SessionUser)` (function) — The agents this person may bring into a piece of work: the workspace's, and theirs.
- L55 `mine(session: AsyncSession, user: SessionUser)` (function) — Every agent this person owns, oldest first.
- L75 `owned(session: AsyncSession, user: SessionUser, agent_id: str)` (function) — The agent, if it is this person's. 404 otherwise — whose it is stays private.
- L95 `free_slug(session: AsyncSession, workspace_id: str, base: str)` (function) — `base`, or the first `base-N` nobody holds. Slugs are per workspace and permanent.
- L115 `channels_for(session: AsyncSession, user: SessionUser, bot_id: str | None)` (function) — Where this person's agent could be, and where it is.
