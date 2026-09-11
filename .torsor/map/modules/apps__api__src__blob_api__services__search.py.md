---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/services/search.py

Symbols in `apps/api/src/blob_api/services/search.py`.

- L41 `SearchCursor` (class) — Where the previous page stopped, as the sort key it stopped on.
- L56 `encode(self)` (method)
- L65 `decode(raw: str)` (method)
- L82 `ParsedQuery` (class) — Slack-style modifiers pulled out of a raw query string.
- L97 `parse_query(raw: str)` (function)
- L139 `_day_start(value: str)` (function) — A date the SQL parameter will accept, refused as input rather than as a 500.
- L154 `search(session: AsyncSession, *, workspace_id: str, user_id: str, query: str, author_id: str | None=None, channel_id: str | None=None, before: datetime | None=None, after: datetime | None=None, has: str | None=None, limit: int=25, cursor: SearchCursor | None=None, sort: str='relevance')` (function)
