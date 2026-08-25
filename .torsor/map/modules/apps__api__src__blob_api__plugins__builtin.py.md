---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T16:15:58'
updated: '2026-08-25T16:15:58'
---

# apps/api/src/blob_api/plugins/builtin.py

Symbols in `apps/api/src/blob_api/plugins/builtin.py`.

- L46 `Persona` (class) — Who this agent is. The one thing that differs between built-in agents.
- L61 `system_prompt(persona: Persona, *, channel_name: str)` (function) — What the agent is told before it sees a word of the conversation.
- L104 `turns_from(messages: Sequence[Mapping[str, Any]])` (function) — AG-UI `Message[]` as model turns, with the speaker kept in the text.
- L129 `_context_value(run_input: Mapping[str, Any], description: str)` (function)
- L138 `stream(run_input: Mapping[str, Any], persona: Persona)` (function) — Run the agent, yielding AG-UI events.
