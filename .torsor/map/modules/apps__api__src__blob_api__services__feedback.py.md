---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:40:59'
updated: '2026-08-21T06:40:59'
---

# apps/api/src/blob_api/services/feedback.py

Symbols in `apps/api/src/blob_api/services/feedback.py`.

- L38 `_snapshot_key(workspace_id: str, ticket_id: str)` (function)
- L42 `create(workspace_id: str, reporter_id: str, payload: FeedbackInput)` (function)
- L94 `listing(session: AsyncSession, workspace_id: str, status: str | None=None)` (function)
- L117 `set_status(actor: Actor, ticket_id: str, status: str)` (function)
- L158 `snapshot_key_for(session: AsyncSession, workspace_id: str, ticket_id: str)` (function)
- L174 `remove(actor: Actor, ticket_id: str)` (function)
- L210 `_json(value: dict[str, str])` (function)
