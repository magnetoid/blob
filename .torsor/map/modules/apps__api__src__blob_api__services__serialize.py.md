---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T01:21:53'
updated: '2026-08-21T01:21:53'
---

# apps/api/src/blob_api/services/serialize.py

Symbols in `apps/api/src/blob_api/services/serialize.py`.

- L34 `_prefs(raw: dict[str, Any] | None)` (function)
- L38 `to_user(row: Any)` (function)
- L58 `to_current_user(row: Any)` (function)
- L63 `to_workspace(row: Any)` (function)
- L69 `to_channel(row: Any)` (function)
- L85 `to_channel_with_state(row: Any)` (function)
- L109 `to_attachment(raw: dict[str, Any])` (function)
- L122 `to_message(row: Any)` (function)
- L161 `_as_datetime(value: Any)` (function)
- L167 `to_thread_summary(row: Any)` (function)
- L193 `to_agent_task(row: Any)` (function)
- L215 `to_message_translation(row: Any, *, cached: bool=False)` (function)
- L231 `message_event(name: str, message: Message)` (function) — The socket envelope carrying a message. Shared so every sender emits one shape.
