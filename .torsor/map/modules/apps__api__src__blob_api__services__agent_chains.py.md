---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/services/agent_chains.py

Symbols in `apps/api/src/blob_api/services/agent_chains.py`.

- L58 `Chain` (class) — Where a run sits, and on whose authority it runs.
- L77 `is_root(self)` (method)
- L81 `root(trigger: Any)` (function) — A person's own message: the start of a chain, with themselves as its authority.
- L86 `child_of(session: AsyncSession, *, parent_run_id: str, trigger: Any)` (function) — The hop an agent's reply starts, or None if there is no chain for it to extend.
- L132 `resume_of(session: AsyncSession, *, parent_run_id: str, trigger: Any)` (function) — The run a person's answer resumes, and the bot user to run it as.
- L190 `can_spawn(chain: Chain, max_depth: int)` (function) — Whether a reply from this run may carry the chain one hop further.
- L195 `admit(session: AsyncSession, chain: Chain, *, candidates: list[tuple[str, str]], max_depth: int)` (function) — Which of these (plugin_id, bot_user_id) pairs a hop may run. Budgets only.
- L274 `Answered` (class)
- L280 `answer(session: AsyncSession, after: Any, *, workspace_id: str, run_id: str, user_id: str, user_name: str, action_id: str | None, value: str, client_action_id: str | None)` (function) — The person who asked answers; the run that asked resumes.
