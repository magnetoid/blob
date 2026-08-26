---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/realtime/presence.py

Symbols in `apps/api/src/blob_api/realtime/presence.py`.

- L22 `mark_active(user_id: str)` (function)
- L29 `mark_away(user_id: str)` (function)
- L36 `mark_offline(user_id: str)` (function) — Called when a user's last connection drops.
- L44 `get_presence(user_ids: list[str])` (function)
- L54 `set_typing(channel_id: str, user_id: str, thread_root_id: str | None)` (function)
- L67 `_announce(user_id: str, state: PresenceState)` (function)
