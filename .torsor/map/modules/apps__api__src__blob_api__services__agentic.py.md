---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T05:53:40'
updated: '2026-09-06T05:53:40'
---

# apps/api/src/blob_api/services/agentic.py

Symbols in `apps/api/src/blob_api/services/agentic.py`.

- L123 `SummaryPayload` (class)
- L132 `_ModelItem` (class)
- L140 `_ModelSummary` (class)
- L149 `model_provider()` (function)
- L153 `_normalize_text(raw: str)` (function)
- L158 `_clip(raw: str)` (function)
- L162 `_participants(messages: Iterable[Message])` (function)
- L169 `_message_sentences(messages: Iterable[Message])` (function)
- L183 `summarize_messages(messages: Sequence[Message])` (function) — The keyword scan. Never empty-handed: a thread with nothing that matches still
- L258 `transcript(messages: Sequence[Message], names: Mapping[str, str])` (function) — Number the thread for the model, bounded on every axis.
- L298 `model_summary(messages: Sequence[Message], *, names: Mapping[str, str])` (function) — Ask the model, then turn its numbers into ids. Raises `llm.LlmError` when it cannot
- L396 `read_thread(session: AsyncSession, thread_root_id: str)` (function) — The thread and its speakers' names — everything a summary needs, read once.
- L416 `build_summary(messages: Sequence[Message], *, names: Mapping[str, str])` (function) — The summary and who wrote it. Call with no session held: this is the model call.
- L432 `get_summary(session: AsyncSession, thread_root_id: str)` (function)
- L442 `store_summary(session: AsyncSession, *, workspace_id: str, channel_id: str, thread_root_id: str, created_by: str | None, provider: str, payload: SummaryPayload)` (function) — One row per thread; a refresh keeps the row's id, which tasks point at.
- L500 `list_tasks_for_thread(session: AsyncSession, thread_root_id: str)` (function)
- L519 `parse_due_at(raw: str | None)` (function) — A task's due date, as something asyncpg will bind.
- L535 `create_task(session: AsyncSession, *, workspace_id: str, channel_id: str, thread_root_id: str | None, created_by: str | None, assignee_user_id: str | None, title: str, instructions: str, priority: str, due_at: str | None, summary_id: str | None, external_ref: dict[str, str])` (function)
- L620 `get_task(session: AsyncSession, task_id: str)` (function)
- L639 `_completed_at_for(status: str | None, previous: AgentTask)` (function)
- L649 `update_task(session: AsyncSession, *, task_id: str, workspace_id: str, assignee_user_id: str | None, status: str | None, priority: str | None, due_at: str | None, outcome: str | None, instructions: str | None)` (function)
