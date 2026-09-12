---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T01:33:41'
updated: '2026-09-13T01:33:41'
---

# apps/api/src/blob_api/jobs/agui_admission.py

Symbols in `apps/api/src/blob_api/jobs/agui_admission.py`.

- L34 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L86 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The built-in agent, if this channel is one person's private room with it.
- L160 `agent_tools(listener: Listener, *, workspace_id: str, user_id: str)` (function) — The tools this agent may use, and a runner that runs them as the person who asked.
- L242 `looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
