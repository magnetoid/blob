---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:40:59'
updated: '2026-08-21T06:40:59'
---

# apps/api/src/blob_api/services/serialize.py

Symbols in `apps/api/src/blob_api/services/serialize.py`.

- L35 `_prefs(raw: dict[str, Any] | None)` (function)
- L39 `to_user(row: Any)` (function)
- L59 `to_current_user(row: Any)` (function)
- L64 `to_workspace(row: Any)` (function)
- L70 `to_channel(row: Any)` (function)
- L86 `to_channel_with_state(row: Any)` (function)
- L110 `to_attachment(raw: dict[str, Any])` (function)
- L123 `to_message(row: Any)` (function)
- L162 `_as_datetime(value: Any)` (function)
- L168 `to_thread_summary(row: Any)` (function)
- L194 `to_agent_task(row: Any)` (function)
- L216 `to_message_translation(row: Any, *, cached: bool=False)` (function)
- L232 `message_event(name: str, message: Message)` (function) — The socket envelope carrying a message. Shared so every sender emits one shape.
- L262 `to_feedback_ticket(row: Any)` (function)
