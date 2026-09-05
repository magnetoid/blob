---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/plugins/decisions.py

Symbols in `apps/api/src/blob_api/plugins/decisions.py`.

- L36 `decision_blocks(run_id: str, decision: Decision)` (function) — The question, and the way to answer it.
- L67 `settled_blocks(decision: Decision, *, answered_by: str, answer: str)` (function) — The same question, closed: who answered and what they said. No buttons.
- L80 `expired_blocks(decision: Decision)` (function)
- L87 `run_id_of(action_id: str)` (function) — The run an action id belongs to, or None if it is some app's ordinary button.
- L98 `payload_for(decision: Decision, action_id: str | None, value: str)` (function) — What to post as the person's message, and what to hand the agent as `payload`.
- L117 `_prompt_block(decision: Decision)` (function)
- L121 `_context(text: str)` (function)
- L125 `_clip(text: str, limit: int)` (function)
