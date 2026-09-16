---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/search.py

Symbols in `apps/api/src/blob_api/routers/search.py`.

- L26 `ParsedOut` (class)
- L35 `SearchOut` (class)
- L45 `SyncOut` (class)
- L54 `search_messages(q: Annotated[str, Query(min_length=1, max_length=200)], limit: Annotated[int, Query(ge=1, le=50)]=25, cursor: Annotated[str | None, Query(max_length=100)]=None, sort: Annotated[str, Query(pattern='^(relevance|newest)$')]='relevance', user: SessionUser=Depends(current_user))` (function)
- L133 `sync(cursors: str | None=None, user: SessionUser=Depends(current_user))` (function) — Reconnect delta.
