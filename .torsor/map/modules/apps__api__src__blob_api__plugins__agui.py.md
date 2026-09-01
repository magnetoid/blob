---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/plugins/agui.py

Symbols in `apps/api/src/blob_api/plugins/agui.py`.

- L53 `Post` (class) — One Blob message a run wants written.
- L62 `client_msg_id(self, run_id: str)` (method) — Deterministic, so re-running a job cannot post the answer twice.
- L72 `blocks(self)` (method) — A context block naming the tools the agent used, or None.
- L87 `Fold` (class) — Reduces an AG-UI event stream into the messages Blob will write.
- L96 `__init__(self, *, max_body_chars: int=MAX_BODY_CHARS)` (method)
- L108 `posted(self)` (method)
- L111 `feed(self, event: Mapping[str, Any])` (method)
- L162 `finish(self)` (method) — Seal every message still open, oldest first.
- L169 `_append(self, message_id: str, delta: str)` (method)
- L183 `_seal(self, message_id: str)` (method)
- L190 `_emit(self, message_id: str, raw: str)` (method)
- L204 `_message_id(event: Mapping[str, Any])` (function) — The correlation key, with a fallback.
- L215 `_interrupt_prompt(event: Mapping[str, Any])` (function) — The question an agent stopped to ask, if it stopped to ask one.
- L237 `to_agui_messages(messages: Sequence[Message], *, bot_user_id: str, names: Mapping[str, str])` (function) — Blob history as AG-UI `Message[]`, oldest first.
- L265 `build_run_input(*, thread_id: str, run_id: str, messages: list[dict[str, Any]], channel_name: str, trigger_user: str)` (function) — The POST body.
