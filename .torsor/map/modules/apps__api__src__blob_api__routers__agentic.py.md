---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T06:59:43'
updated: '2026-09-06T06:59:43'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L36 `ThreadSummaryOut` (class)
- L40 `AgentTasksOut` (class)
- L44 `AgentTaskOut` (class)
- L48 `_root_message(message_id: str, user: SessionUser)` (function)
- L59 `get_thread_summary(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L69 `refresh_thread_summary(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L111 `list_thread_tasks(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L121 `create_thread_task(message_id: IdParam, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L178 `update_task(task_id: IdParam, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L240 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
- L292 `CatchupInput` (class)
- L296 `CatchupSummaryOut` (class)
- L304 `CatchupOut` (class)
- L309 `catch_me_up(payload: CatchupInput, user: SessionUser=Depends(current_user))` (function) — Summarise what you haven't read — one channel, or the busiest few.
- L346 `AgentRunsOut` (class)
- L350 `OkOut` (class)
- L355 `channel_agent_runs(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — The runs a conversation renders on load: live cards plus the recent tail.
- L372 `cancel_agent_run(run_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Stop an in-flight run.
- L433 `AnswerInput` (class) — A free-text answer to the decision a run is waiting on.
- L446 `answer_agent_run(run_id: IdParam, payload: AnswerInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Answer the question an agent stopped to ask, and let it carry on.
