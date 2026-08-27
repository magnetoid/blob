---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/search.py

Symbols in `apps/api/src/blob_api/routers/search.py`.

- L25 `ParsedOut` (class)
- L34 `SearchOut` (class)
- L40 `SyncOut` (class)
- L49 `search_messages(q: Annotated[str, Query(min_length=1, max_length=200)], limit: Annotated[int, Query(ge=1, le=50)]=25, user: SessionUser=Depends(current_user))` (function)
- L115 `sync(cursors: str | None=None, user: SessionUser=Depends(current_user))` (function) — Reconnect delta.
