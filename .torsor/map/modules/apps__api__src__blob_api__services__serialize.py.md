---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/serialize.py

Symbols in `apps/api/src/blob_api/services/serialize.py`.

- L41 `read_prefs(raw: dict[str, Any] | None)` (function) — Stored preferences, tolerant of what an older, looser schema let in.
- L73 `_prefs(raw: dict[str, Any] | None)` (function)
- L77 `to_user(row: Any)` (function)
- L101 `to_current_user(row: Any)` (function)
- L106 `to_workspace(row: Any)` (function)
- L112 `to_channel(row: Any)` (function)
- L130 `to_channel_with_state(row: Any)` (function)
- L154 `to_attachment(raw: dict[str, Any])` (function)
- L172 `to_message(row: Any)` (function)
- L217 `_as_datetime(value: Any)` (function)
- L223 `to_thread_summary(row: Any)` (function)
- L256 `to_agent_task(row: Any)` (function)
- L278 `to_message_translation(row: Any, *, cached: bool=False)` (function)
- L294 `message_event(name: str, message: Message)` (function) — The socket envelope carrying a message. Shared so every sender emits one shape.
- L299 `channel_event(name: str, channel: Channel)` (function) — A channel event for the room: what the channel *is*, never who you are in it.
- L315 `membership_event(channel: ChannelWithState)` (function) — One person's own state in one channel. Only ever sent to that person.
- L377 `to_feedback_ticket(row: Any)` (function)
