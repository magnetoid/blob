---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
---

# apps/api/src/blob_api/services/agentic.py

Symbols in `apps/api/src/blob_api/services/agentic.py`.

- L33 `SummaryPayload` (class)
- L42 `_normalize_text(raw: str)` (function)
- L47 `_message_sentences(messages: Iterable[Message])` (function)
- L67 `summarize_messages(messages: Sequence[Message])` (function)
- L132 `get_summary(session: AsyncSession, thread_root_id: str)` (function)
- L142 `generate_summary(session: AsyncSession, *, workspace_id: str, channel_id: str, thread_root_id: str, created_by: str | None)` (function)
- L199 `list_tasks_for_thread(session: AsyncSession, thread_root_id: str)` (function)
- L218 `parse_due_at(raw: str | None)` (function) — A task's due date, as something asyncpg will bind.
- L234 `create_task(session: AsyncSession, *, workspace_id: str, channel_id: str, thread_root_id: str | None, created_by: str | None, assignee_user_id: str | None, title: str, instructions: str, priority: str, due_at: str | None, summary_id: str | None, external_ref: dict[str, str])` (function)
- L319 `get_task(session: AsyncSession, task_id: str)` (function)
- L338 `_completed_at_for(status: str | None, previous: AgentTask)` (function)
- L348 `update_task(session: AsyncSession, *, task_id: str, workspace_id: str, assignee_user_id: str | None, status: str | None, priority: str | None, due_at: str | None, outcome: str | None, instructions: str | None)` (function)
