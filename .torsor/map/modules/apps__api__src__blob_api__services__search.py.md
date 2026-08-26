---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/services/search.py

Symbols in `apps/api/src/blob_api/services/search.py`.

- L25 `ParsedQuery` (class) — Slack-style modifiers pulled out of a raw query string.
- L40 `parse_query(raw: str)` (function)
- L71 `_day_start(value: str)` (function) — A date the SQL parameter will accept, refused as input rather than as a 500.
- L86 `search(session: AsyncSession, *, workspace_id: str, user_id: str, query: str, author_id: str | None=None, channel_id: str | None=None, before: datetime | None=None, after: datetime | None=None, has: str | None=None, limit: int=25)` (function)
