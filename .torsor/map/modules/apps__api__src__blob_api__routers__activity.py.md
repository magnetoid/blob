---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/routers/activity.py

Symbols in `apps/api/src/blob_api/routers/activity.py`.

- L18 `ActivityItemOut` (class)
- L29 `ActivityOut` (class)
- L35 `activity(kind: Annotated[str, Query(pattern='^(all|mention|reaction|reminder|recap)$')]='all', limit: Annotated[int, Query(ge=1, le=50)]=30, cursor: Annotated[str | None, Query(max_length=120)]=None, user: SessionUser=Depends(current_user))` (function) — Mentions of you, reactions to what you wrote, and stored extra kinds.
