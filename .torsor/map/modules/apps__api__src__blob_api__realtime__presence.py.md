---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T16:15:58'
updated: '2026-08-25T16:15:58'
---

# apps/api/src/blob_api/realtime/presence.py

Symbols in `apps/api/src/blob_api/realtime/presence.py`.

- L23 `mark_active(user_id: str)` (function)
- L30 `mark_away(user_id: str)` (function)
- L37 `mark_offline(user_id: str)` (function) — Called when a user's last connection drops.
- L45 `get_presence(user_ids: list[str])` (function)
- L55 `set_typing(channel_id: str, user_id: str, thread_root_id: str | None)` (function)
- L68 `_announce(user_id: str, state: PresenceState)` (function)
