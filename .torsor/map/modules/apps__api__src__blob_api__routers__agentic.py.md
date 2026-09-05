---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:23'
updated: '2026-09-05T04:19:23'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L35 `ThreadSummaryOut` (class)
- L39 `AgentTasksOut` (class)
- L43 `AgentTaskOut` (class)
- L47 `_root_message(message_id: str, user: SessionUser)` (function)
- L58 `get_thread_summary(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L68 `refresh_thread_summary(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L101 `list_thread_tasks(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L111 `create_thread_task(message_id: IdParam, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L168 `update_task(task_id: IdParam, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L230 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
- L282 `CatchupInput` (class)
- L286 `CatchupSummaryOut` (class)
- L294 `CatchupOut` (class)
- L299 `catch_me_up(payload: CatchupInput, user: SessionUser=Depends(current_user))` (function) — Summarise what you haven't read — one channel, or the busiest few.
- L336 `AgentRunsOut` (class)
- L340 `OkOut` (class)
- L345 `channel_agent_runs(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — The runs a conversation renders on load: live cards plus the recent tail.
- L362 `cancel_agent_run(run_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Stop an in-flight run.
- L423 `AnswerInput` (class) — A free-text answer to the decision a run is waiting on.
- L436 `answer_agent_run(run_id: IdParam, payload: AnswerInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Answer the question an agent stopped to ask, and let it carry on.
