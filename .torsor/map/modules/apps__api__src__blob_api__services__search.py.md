---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T02:35:20'
updated: '2026-09-16T02:35:20'
---

# apps/api/src/blob_api/services/search.py

Symbols in `apps/api/src/blob_api/services/search.py`.

- L43 `prefix_lexeme(query: str)` (function) — `deplo:*` for the last token, so a partial word still hits the tsvector.
- L61 `ilike_needle(query: str)` (function) — Substring fallback for short queries; `%`/`_` in the input stay literal.
- L70 `SearchCursor` (class) — Where the previous page stopped, as the sort key it stopped on.
- L85 `encode(self)` (method)
- L94 `decode(raw: str)` (method)
- L111 `ParsedQuery` (class) — Slack-style modifiers pulled out of a raw query string.
- L125 `scoped(self)` (method) — True when a modifier is present, even with no free text.
- L134 `parse_query(raw: str)` (function)
- L176 `_day_start(value: str)` (function) — A date the SQL parameter will accept, refused as input rather than as a 500.
- L191 `resolve_author(session: AsyncSession, workspace_id: str, name: str)` (function) — Who `from:@name` means, or None when it names nobody — or more than one person.
- L218 `resolve_channel(session: AsyncSession, workspace_id: str, name: str)` (function) — Which channel `in:#name` means, or None. Membership is the search's own filter.
- L229 `search(session: AsyncSession, *, workspace_id: str, user_id: str, query: str, author_id: str | None=None, channel_id: str | None=None, before: datetime | None=None, after: datetime | None=None, has: str | None=None, limit: int=25, cursor: SearchCursor | None=None, sort: str='relevance')` (function)
