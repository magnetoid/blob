---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/services/activity.py

Symbols in `apps/api/src/blob_api/services/activity.py`.

- L39 `ActivityCursor` (class) — Where the previous page stopped: the sort key it stopped on, all three parts.
- L52 `encode(self)` (method)
- L57 `decode(raw: str)` (method)
- L72 `ActivityItem` (class)
- L148 `feed(session: AsyncSession, *, workspace_id: str, user_id: str, kind: str='all', limit: int=30, cursor: ActivityCursor | None=None)` (function)
