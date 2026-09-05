---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/services/agent_state.py

Symbols in `apps/api/src/blob_api/services/agent_state.py`.

- L25 `load(session: AsyncSession, *, plugin_id: str, thread_key: str)` (function)
- L35 `save(session: AsyncSession, *, workspace_id: str, plugin_id: str, thread_key: str, state_json: str)` (function) — Replace what the agent remembers here. `state_json` is already serialised and
- L59 `forget(session: AsyncSession, *, plugin_id: str, thread_key: str | None=None)` (function) — Drop what an agent remembers — everywhere, or in one conversation.
