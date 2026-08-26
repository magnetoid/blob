---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/services/read_state.py

Symbols in `apps/api/src/blob_api/services/read_state.py`.

- L21 `mark_read(session: AsyncSession, user_id: str, channel_id: str, last_read_message_id: str)` (function)
- L54 `mark_unread(session: AsyncSession, user_id: str, channel_id: str, message_id: str)` (function) — Leave this message, and everything after it, unread.
- L137 `increment_mentions(session: AsyncSession, user_ids: list[str], channel_id: str)` (function) — Called by the notify worker for each recipient a message actually pings.
- L170 `broadcast(user_id: str, state: ReadStateOut)` (function) — Other devices belonging to this user need to clear their badge too.
- L175 `list_for_user(session: AsyncSession, user_id: str)` (function)
- L197 `total_mentions(session: AsyncSession, user_id: str)` (function) — Total badge across the workspace — what the tab title and favicon show.
