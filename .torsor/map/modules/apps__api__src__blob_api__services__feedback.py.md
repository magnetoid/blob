---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T03:28:21'
updated: '2026-09-02T03:28:21'
---

# apps/api/src/blob_api/services/feedback.py

Symbols in `apps/api/src/blob_api/services/feedback.py`.

- L38 `_snapshot_key(workspace_id: str, ticket_id: str)` (function)
- L42 `create(workspace_id: str, reporter_id: str, payload: FeedbackInput)` (function)
- L96 `listing(session: AsyncSession, workspace_id: str, status: str | None=None)` (function)
- L119 `set_status(actor: Actor, ticket_id: str, status: str)` (function)
- L160 `snapshot_key_for(session: AsyncSession, workspace_id: str, ticket_id: str)` (function)
- L172 `remove(actor: Actor, ticket_id: str)` (function)
- L208 `_json(value: dict[str, str])` (function)
