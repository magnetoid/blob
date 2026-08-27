---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L32 `ThreadSummaryOut` (class)
- L36 `AgentTasksOut` (class)
- L40 `AgentTaskOut` (class)
- L44 `_root_message(message_id: str, user: SessionUser)` (function)
- L55 `get_thread_summary(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L65 `refresh_thread_summary(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L98 `list_thread_tasks(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L108 `create_thread_task(message_id: str, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L164 `update_task(task_id: str, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L225 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
- L277 `CatchupInput` (class)
- L281 `CatchupSummaryOut` (class)
- L289 `CatchupOut` (class)
- L294 `catch_me_up(payload: CatchupInput, user: SessionUser=Depends(current_user))` (function) — Summarise what you haven't read — one channel, or the busiest few.
- L331 `AgentRunsOut` (class)
- L335 `OkOut` (class)
- L340 `channel_agent_runs(channel_id: str, user: SessionUser=Depends(current_user))` (function) — The runs a conversation renders on load: live cards plus the recent tail.
- L357 `cancel_agent_run(run_id: str, request: Request, user: SessionUser=Depends(current_user))` (function) — Stop an in-flight run.
