---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:20'
updated: '2026-09-02T05:49:20'
---

# apps/api/src/blob_api/realtime/presence.py

Symbols in `apps/api/src/blob_api/realtime/presence.py`.

- L28 `mark_active(user_id: str)` (function)
- L35 `mark_present(user_id: str)` (function) — A heartbeat: still here. Not a claim about *how*.
- L60 `mark_away(user_id: str)` (function)
- L67 `mark_offline(user_id: str)` (function) — Called when a user's last local connection drops.
- L84 `track_connection(user_id: str, conn_id: str)` (function)
- L91 `refresh_connection(user_id: str, conn_id: str)` (function) — Keep the registries alive; called on every heartbeat.
- L104 `untrack_connection(user_id: str, conn_id: str)` (function)
- L111 `set_focus(user_id: str, conn_id: str, channel_id: str | None)` (function) — Record which channel one connection is looking at, visible to every process.
- L126 `focused_channels(user_id: str)` (function) — Every channel this user has on screen right now, on any device, any process.
- L131 `get_presence(user_ids: list[str])` (function)
- L141 `set_typing(channel_id: str, user_id: str, thread_root_id: str | None)` (function)
- L154 `_announce(user_id: str, state: PresenceState)` (function)
