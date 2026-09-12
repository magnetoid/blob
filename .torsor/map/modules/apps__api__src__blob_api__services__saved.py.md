---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T01:33:43'
updated: '2026-09-13T01:33:43'
---

# apps/api/src/blob_api/services/saved.py

Symbols in `apps/api/src/blob_api/services/saved.py`.

- L25 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L43 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L62 `set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool)` (function) — Put a message aside, or take it back off the list.
- L93 `set_later(session: AsyncSession, message_id: str, user_id: str, *, state: str | None=None, remind_at: Any | None=_UNSET, note: Any=_UNSET)` (function) — Update a saved item's Later fields, saving it first if it wasn't.
- L143 `list_later(session: AsyncSession, user_id: str, *, state: str='in_progress', limit: int=100)` (function) — The Later view: saved messages in one state, with their reminder metadata.
- L183 `list_saved(session: AsyncSession, user_id: str, limit: int=100)` (function) — Somebody's saved messages, newest save first.
- L212 `saved_message_ids(session: AsyncSession, user_id: str, limit: int=500)` (function) — Just the ids, for the boot payload.
