---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/services/serialize.py

Symbols in `apps/api/src/blob_api/services/serialize.py`.

- L40 `read_prefs(raw: dict[str, Any] | None)` (function) — Stored preferences, tolerant of what an older, looser schema let in.
- L72 `_prefs(raw: dict[str, Any] | None)` (function)
- L76 `to_user(row: Any)` (function)
- L96 `to_current_user(row: Any)` (function)
- L101 `to_workspace(row: Any)` (function)
- L107 `to_channel(row: Any)` (function)
- L123 `to_channel_with_state(row: Any)` (function)
- L147 `to_attachment(raw: dict[str, Any])` (function)
- L160 `to_message(row: Any)` (function)
- L205 `_as_datetime(value: Any)` (function)
- L211 `to_thread_summary(row: Any)` (function)
- L237 `to_agent_task(row: Any)` (function)
- L259 `to_message_translation(row: Any, *, cached: bool=False)` (function)
- L275 `message_event(name: str, message: Message)` (function) — The socket envelope carrying a message. Shared so every sender emits one shape.
- L325 `to_feedback_ticket(row: Any)` (function)
