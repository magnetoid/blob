---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L35 `ThreadSummaryOut` (class)
- L39 `AgentTasksOut` (class)
- L43 `AgentTaskOut` (class)
- L47 `_root_message(message_id: str, user: SessionUser)` (function)
- L56 `get_thread_summary(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L66 `refresh_thread_summary(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L108 `list_thread_tasks(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L118 `create_thread_task(message_id: IdParam, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L172 `update_task(task_id: IdParam, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L228 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
- L244 `CatchupInput` (class)
- L248 `CatchupSummaryOut` (class)
- L256 `CatchupOut` (class)
- L261 `catch_me_up(payload: CatchupInput, user: SessionUser=Depends(current_user))` (function) — Summarise what you haven't read — one channel, or the busiest few.
- L298 `AgentRunsOut` (class)
- L303 `channel_agent_runs(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — The runs a conversation renders on load: live cards plus the recent tail.
- L320 `workspace_agent_runs(user: SessionUser=Depends(current_user))` (function) — The home dashboard's live strip: running, waiting, and today's tail.
- L335 `cancel_agent_run(run_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Stop an in-flight run.
- L384 `AnswerInput` (class) — A free-text answer to the decision a run is waiting on.
- L397 `answer_agent_run(run_id: IdParam, payload: AnswerInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Answer the question an agent stopped to ask, and let it carry on.
