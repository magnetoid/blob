---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T04:17:08'
updated: '2026-09-06T04:17:08'
---

# apps/api/src/blob_api/routers/search.py

Symbols in `apps/api/src/blob_api/routers/search.py`.

- L25 `ParsedOut` (class)
- L34 `SearchOut` (class)
- L44 `SyncOut` (class)
- L53 `search_messages(q: Annotated[str, Query(min_length=1, max_length=200)], limit: Annotated[int, Query(ge=1, le=50)]=25, cursor: Annotated[str | None, Query(max_length=100)]=None, sort: Annotated[str, Query(pattern='^(relevance|newest)$')]='relevance', user: SessionUser=Depends(current_user))` (function)
- L164 `sync(cursors: str | None=None, user: SessionUser=Depends(current_user))` (function) — Reconnect delta.
