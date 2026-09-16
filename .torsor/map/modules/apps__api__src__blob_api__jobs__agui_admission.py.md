---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T02:35:20'
updated: '2026-09-16T02:35:20'
---

# apps/api/src/blob_api/jobs/agui_admission.py

Symbols in `apps/api/src/blob_api/jobs/agui_admission.py`.

- L28 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L77 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The agent this channel is one person's private room with, when that agent may be
- L160 `looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
