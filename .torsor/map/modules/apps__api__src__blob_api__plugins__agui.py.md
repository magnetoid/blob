---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
---

# apps/api/src/blob_api/plugins/agui.py

Symbols in `apps/api/src/blob_api/plugins/agui.py`.

- L51 `SseDecoder` (class) — Splits a `text/event-stream` byte stream into the JSON objects it carries.
- L63 `__init__(self)` (method)
- L67 `feed(self, chunk: bytes)` (method)
- L75 `close(self)` (method) — Flush whatever arrived without a trailing blank line.
- L82 `_line(self, line: str)` (method)
- L92 `_dispatch(self)` (method)
- L107 `Post` (class) — One Blob message a run wants written.
- L116 `client_msg_id(self, run_id: str)` (method) — Deterministic, so re-running a job cannot post the answer twice.
- L126 `blocks(self)` (method) — A context block naming the tools the agent used, or None.
- L141 `Fold` (class) — Reduces an AG-UI event stream into the messages Blob will write.
- L150 `__init__(self, *, max_body_chars: int=MAX_BODY_CHARS)` (method)
- L162 `posted(self)` (method)
- L165 `feed(self, event: Mapping[str, Any])` (method)
- L216 `finish(self)` (method) — Seal every message still open, oldest first.
- L223 `_append(self, message_id: str, delta: str)` (method)
- L237 `_seal(self, message_id: str)` (method)
- L244 `_emit(self, message_id: str, raw: str)` (method)
- L258 `_message_id(event: Mapping[str, Any])` (function) — The correlation key, with a fallback.
- L269 `_interrupt_prompt(event: Mapping[str, Any])` (function) — The question an agent stopped to ask, if it stopped to ask one.
- L291 `to_agui_messages(messages: Sequence[Message], *, bot_user_id: str, names: Mapping[str, str])` (function) — Blob history as AG-UI `Message[]`, oldest first.
- L319 `build_run_input(*, thread_id: str, run_id: str, messages: list[dict[str, Any]], channel_name: str, trigger_user: str)` (function) — The POST body.
