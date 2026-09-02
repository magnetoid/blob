---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T06:48:47'
updated: '2026-09-02T06:48:47'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L33 `ThreadSummaryOut` (class)
- L37 `AgentTasksOut` (class)
- L41 `AgentTaskOut` (class)
- L45 `_root_message(message_id: str, user: SessionUser)` (function)
- L56 `get_thread_summary(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L66 `refresh_thread_summary(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L99 `list_thread_tasks(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L109 `create_thread_task(message_id: IdParam, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L166 `update_task(task_id: IdParam, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L228 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
- L280 `CatchupInput` (class)
- L284 `CatchupSummaryOut` (class)
- L292 `CatchupOut` (class)
- L297 `catch_me_up(payload: CatchupInput, user: SessionUser=Depends(current_user))` (function) — Summarise what you haven't read — one channel, or the busiest few.
- L334 `AgentRunsOut` (class)
- L338 `OkOut` (class)
- L343 `channel_agent_runs(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — The runs a conversation renders on load: live cards plus the recent tail.
- L360 `cancel_agent_run(run_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Stop an in-flight run.
