---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:23'
updated: '2026-09-05T04:19:23'
---

# apps/api/src/blob_api/plugins/agui.py

Symbols in `apps/api/src/blob_api/plugins/agui.py`.

- L71 `Post` (class) — One Blob message a run wants written.
- L80 `client_msg_id(self, run_id: str)` (method) — Deterministic, so re-running a job cannot post the answer twice.
- L90 `blocks(self)` (method) — A context block naming the tools the agent used, or None.
- L105 `Fold` (class) — Reduces an AG-UI event stream into the messages Blob will write.
- L114 `__init__(self, *, max_body_chars: int=MAX_BODY_CHARS)` (method)
- L134 `posted(self)` (method)
- L137 `feed(self, event: Mapping[str, Any])` (method)
- L205 `_take_state(self, state: Any)` (method) — Keep the state if it fits; drop it for the rest of the run if it does not.
- L218 `finish(self)` (method) — Seal every message still open, oldest first.
- L225 `_append(self, message_id: str, delta: str)` (method)
- L239 `_seal(self, message_id: str)` (method)
- L246 `_emit(self, message_id: str, raw: str)` (method)
- L260 `_message_id(event: Mapping[str, Any])` (function) — The correlation key, with a fallback.
- L271 `interrupts_of(event: Mapping[str, Any])` (function) — The `interrupts[]` a RUN_FINISHED carried, capped, or None if it ended cleanly.
- L303 `interrupt_prompt(interrupts: Sequence[Mapping[str, Any]] | None)` (function) — The question an agent stopped to ask, as one line, or None if it did not stop.
- L316 `Choice` (class)
- L322 `Decision` (class) — What the person is being asked, and how they may answer it.
- L336 `free_text(self)` (method)
- L340 `decision_of(interrupts: Sequence[Mapping[str, Any]] | None)` (function)
- L357 `_choices_of(item: Mapping[str, Any])` (function)
- L397 `_earliest_expiry(items: Sequence[Mapping[str, Any]])` (function)
- L414 `to_agui_messages(messages: Sequence[Message], *, bot_user_id: str, names: Mapping[str, str])` (function) — Blob history as AG-UI `Message[]`, oldest first.
- L442 `build_run_input(*, thread_id: str, run_id: str, messages: list[dict[str, Any]], channel_name: str, trigger_user: str, asked_by_agent: str | None=None, on_behalf_of: str | None=None, participants: Sequence[str]=(), state: Any=None, parent_run_id: str | None=None, resume: Sequence[Mapping[str, Any]] | None=None)` (function) — The POST body.
