---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T03:28:21'
updated: '2026-09-02T03:28:21'
---

# apps/api/src/blob_api/realtime/presence.py

Symbols in `apps/api/src/blob_api/realtime/presence.py`.

- L28 `mark_active(user_id: str)` (function)
- L35 `mark_away(user_id: str)` (function)
- L42 `mark_offline(user_id: str)` (function) — Called when a user's last local connection drops.
- L59 `track_connection(user_id: str, conn_id: str)` (function)
- L66 `refresh_connection(user_id: str, conn_id: str)` (function) — Keep the registries alive; called on every heartbeat.
- L79 `untrack_connection(user_id: str, conn_id: str)` (function)
- L86 `set_focus(user_id: str, conn_id: str, channel_id: str | None)` (function) — Record which channel one connection is looking at, visible to every process.
- L101 `focused_channels(user_id: str)` (function) — Every channel this user has on screen right now, on any device, any process.
- L106 `get_presence(user_ids: list[str])` (function)
- L116 `set_typing(channel_id: str, user_id: str, thread_root_id: str | None)` (function)
- L129 `_announce(user_id: str, state: PresenceState)` (function)
