---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/src/blob_api/routers/agentic.py

Symbols in `apps/api/src/blob_api/routers/agentic.py`.

- L27 `ThreadSummaryOut` (class)
- L31 `AgentTasksOut` (class)
- L35 `AgentTaskOut` (class)
- L39 `_root_message(message_id: str, user: SessionUser)` (function)
- L50 `get_thread_summary(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L60 `refresh_thread_summary(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L93 `list_thread_tasks(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L103 `create_thread_task(message_id: str, payload: CreateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L159 `update_task(task_id: str, payload: UpdateAgentTaskInput, request: Request, user: SessionUser=Depends(current_user))` (function)
- L220 `list_tasks(assignee: str | None=None, status: Annotated[str | None, Query()]=None, user: SessionUser=Depends(current_user))` (function)
