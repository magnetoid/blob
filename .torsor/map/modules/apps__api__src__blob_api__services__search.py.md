---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T03:28:21'
updated: '2026-09-02T03:28:21'
---

# apps/api/src/blob_api/services/search.py

Symbols in `apps/api/src/blob_api/services/search.py`.

- L26 `SearchCursor` (class) — Where the previous page stopped, as the sort key it stopped on.
- L38 `encode(self)` (method)
- L45 `decode(raw: str)` (method)
- L60 `ParsedQuery` (class) — Slack-style modifiers pulled out of a raw query string.
- L75 `parse_query(raw: str)` (function)
- L117 `_day_start(value: str)` (function) — A date the SQL parameter will accept, refused as input rather than as a 500.
- L132 `search(session: AsyncSession, *, workspace_id: str, user_id: str, query: str, author_id: str | None=None, channel_id: str | None=None, before: datetime | None=None, after: datetime | None=None, has: str | None=None, limit: int=25, cursor: SearchCursor | None=None)` (function)
