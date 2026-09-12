---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/services/activity.py

Symbols in `apps/api/src/blob_api/services/activity.py`.

- L47 `ActivityCursor` (class) — Where the previous page stopped: the sort key it stopped on, all three parts.
- L60 `encode(self)` (method)
- L65 `decode(raw: str)` (method)
- L80 `ActivityItem` (class)
- L91 `record(session: AsyncSession, *, workspace_id: str, user_id: str, kind: str, actor_id: str | None, channel_id: str | None, message_id: str | None, emoji: str | None=None, payload: dict[str, Any] | None=None)` (function) — Write one event. Idempotent on (user, kind, message, actor, emoji).
- L140 `record_direct_mentions(session: AsyncSession, *, workspace_id: str, channel_id: str, message_id: str, actor_id: str, user_ids: list[str])` (function) — Persist a mention row for each named person except the author.
- L163 `record_reaction(session: AsyncSession, *, message_id: str, actor_id: str, emoji: str)` (function) — Persist a reaction event for the author, when somebody else reacted.
- L281 `feed(session: AsyncSession, *, workspace_id: str, user_id: str, kind: str='all', limit: int=30, cursor: ActivityCursor | None=None)` (function)
