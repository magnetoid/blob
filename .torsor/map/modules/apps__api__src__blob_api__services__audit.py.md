---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T04:30:13'
updated: '2026-08-25T04:30:13'
---

# apps/api/src/blob_api/services/audit.py

Symbols in `apps/api/src/blob_api/services/audit.py`.

- L69 `Actor` (class)
- L75 `actor_for(request: Request, user: SessionUser)` (function) — Who did it, and from where. The address is what makes the log forensic.
- L84 `AuditEntry` (class)
- L97 `record(session: AsyncSession, actor: Actor, action: str, *, target_type: str | None=None, target_id: str | None=None, metadata: dict[str, Any] | None=None)` (function)
- L128 `list_events(session: AsyncSession, workspace_id: str, *, actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: int=50)` (function) — Newest first. UUIDv7 ids sort chronologically, so `before` is a keyset cursor.
