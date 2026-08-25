---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T10:13:28'
updated: '2026-08-25T10:13:28'
---

# apps/api/src/blob_api/routers/search.py

Symbols in `apps/api/src/blob_api/routers/search.py`.

- L27 `ParsedOut` (class)
- L36 `SearchOut` (class)
- L42 `SyncOut` (class)
- L51 `search_messages(q: Annotated[str, Query(min_length=1, max_length=200)], limit: Annotated[int, Query(ge=1, le=50)]=25, user: SessionUser=Depends(current_user))` (function)
- L117 `sync(cursors: str | None=None, user: SessionUser=Depends(current_user))` (function) — Reconnect delta.
