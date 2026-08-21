---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T19:55:03'
updated: '2026-08-21T19:55:03'
---

# apps/api/src/blob_api/services/read_state.py

Symbols in `apps/api/src/blob_api/services/read_state.py`.

- L21 `mark_read(session: AsyncSession, user_id: str, channel_id: str, last_read_message_id: str)` (function)
- L54 `advance_for_author(session: AsyncSession, user_id: str, channel_id: str, message_id: str)` (function) — Advance the author's own cursor so their own message never shows as unread.
- L73 `increment_mentions(session: AsyncSession, user_ids: list[str], channel_id: str)` (function) — Called by the notify worker for each recipient a message actually pings.
- L106 `broadcast(user_id: str, state: ReadStateOut)` (function) — Other devices belonging to this user need to clear their badge too.
- L111 `list_for_user(session: AsyncSession, user_id: str)` (function)
- L133 `total_mentions(session: AsyncSession, user_id: str)` (function) — Total badge across the workspace — what the tab title and favicon show.
