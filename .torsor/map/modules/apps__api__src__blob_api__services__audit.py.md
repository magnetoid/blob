---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/src/blob_api/services/audit.py

Symbols in `apps/api/src/blob_api/services/audit.py`.

- L63 `Actor` (class)
- L69 `AuditEntry` (class)
- L82 `record(session: AsyncSession, actor: Actor, action: str, *, target_type: str | None=None, target_id: str | None=None, metadata: dict[str, Any] | None=None)` (function)
- L113 `list_events(session: AsyncSession, workspace_id: str, *, actor_id: str | None=None, action: str | None=None, before: str | None=None, limit: int=50)` (function) — Newest first. UUIDv7 ids sort chronologically, so `before` is a keyset cursor.
