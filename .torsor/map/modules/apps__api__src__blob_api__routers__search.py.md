---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/routers/search.py

Symbols in `apps/api/src/blob_api/routers/search.py`.

- L26 `ParsedOut` (class)
- L35 `SearchOut` (class)
- L45 `ActivityItemOut` (class)
- L56 `ActivityOut` (class)
- L61 `SyncOut` (class)
- L70 `search_messages(q: Annotated[str, Query(min_length=1, max_length=200)], limit: Annotated[int, Query(ge=1, le=50)]=25, cursor: Annotated[str | None, Query(max_length=100)]=None, sort: Annotated[str, Query(pattern='^(relevance|newest)$')]='relevance', user: SessionUser=Depends(current_user))` (function)
- L181 `activity(kind: Annotated[str, Query(pattern='^(all|mention|reaction)$')]='all', limit: Annotated[int, Query(ge=1, le=50)]=30, cursor: Annotated[str | None, Query(max_length=120)]=None, user: SessionUser=Depends(current_user))` (function) — Mentions of you and reactions to what you wrote, newest first.
- L213 `sync(cursors: str | None=None, user: SessionUser=Depends(current_user))` (function) — Reconnect delta.
