---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T05:53:40'
updated: '2026-09-06T05:53:40'
---

# apps/api/src/blob_api/services/serialize.py

Symbols in `apps/api/src/blob_api/services/serialize.py`.

- L41 `read_prefs(raw: dict[str, Any] | None)` (function) — Stored preferences, tolerant of what an older, looser schema let in.
- L73 `_prefs(raw: dict[str, Any] | None)` (function)
- L77 `to_user(row: Any)` (function)
- L97 `to_current_user(row: Any)` (function)
- L102 `to_workspace(row: Any)` (function)
- L108 `to_channel(row: Any)` (function)
- L126 `to_channel_with_state(row: Any)` (function)
- L150 `to_attachment(raw: dict[str, Any])` (function)
- L163 `to_message(row: Any)` (function)
- L208 `_as_datetime(value: Any)` (function)
- L214 `to_thread_summary(row: Any)` (function)
- L247 `to_agent_task(row: Any)` (function)
- L269 `to_message_translation(row: Any, *, cached: bool=False)` (function)
- L285 `message_event(name: str, message: Message)` (function) — The socket envelope carrying a message. Shared so every sender emits one shape.
- L290 `channel_event(name: str, channel: Channel)` (function) — A channel event for the room: what the channel *is*, never who you are in it.
- L306 `membership_event(channel: ChannelWithState)` (function) — One person's own state in one channel. Only ever sent to that person.
- L365 `to_feedback_ticket(row: Any)` (function)
