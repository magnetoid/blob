---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/src/blob_api/services/audit.py

Symbols in `apps/api/src/blob_api/services/audit.py`.

- L74 `Actor` (class)
- L80 `actor_for(request: Request, user: SessionUser)` (function) — Who did it, and from where. The address is what makes the log forensic.
- L89 `AuditEntry` (class)
- L102 `record(session: AsyncSession, actor: Actor, action: str, *, target_type: str | None=None, target_id: str | None=None, metadata: dict[str, Any] | None=None)` (function)
- L133 `list_events(session: AsyncSession, workspace_id: str, *, actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: int=50)` (function) — Newest first. UUIDv7 ids sort chronologically, so `before` is a keyset cursor.
