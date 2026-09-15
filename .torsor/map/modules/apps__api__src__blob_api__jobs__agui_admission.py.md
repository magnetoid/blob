---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:54:21'
updated: '2026-09-15T23:54:21'
---

# apps/api/src/blob_api/jobs/agui_admission.py

Symbols in `apps/api/src/blob_api/jobs/agui_admission.py`.

- L34 `listeners_for(session: AsyncSession, *, workspace_id: str, mention_user_ids: list[str])` (function) — Mentioned bots whose app speaks AG-UI, is enabled, and may post.
- L86 `personal_agent_for(session: AsyncSession, *, workspace_id: str, channel_id: str)` (function) — The agent this channel is one person's private room with, when that agent may be
- L172 `_is_private_room_with(session: AsyncSession, *, channel_id: str, user_id: str, bot_user_id: str)` (function) — Is this channel a DM holding exactly this person and this agent?
- L203 `agent_tools(listener: Listener, *, workspace_id: str, user_id: str, channel_id: str)` (function) — The tools this agent may use, and a runner that runs them as the person who asked.
- L305 `looks_busy(listener: Listener, channel_id: str, thread_root_id: str | None)` (function) — Show the agent typing for as long as it is thinking.
