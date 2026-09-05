---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/plugins/builtin.py

Symbols in `apps/api/src/blob_api/plugins/builtin.py`.

- L45 `Persona` (class) — Who this agent is. The one thing that differs between built-in agents.
- L60 `system_prompt(persona: Persona, *, channel_name: str, participants: Sequence[str]=(), asked_by_agent: str | None=None, on_behalf_of: str | None=None)` (function) — What the agent is told before it sees a word of the conversation.
- L94 `_shared_rules()` (function) — The half that does not change between a channel and a DM.
- L114 `_channel_prompt(persona: Persona, channel_name: str, *, participants: Sequence[str]=(), asked_by_agent: str | None=None, on_behalf_of: str | None=None)` (function) — A group room, and — when other agents are in it — how to work with them.
- L163 `_personal_prompt(persona: Persona, owner_name: str)` (function) — A private, one-to-one room, and it has to be described as one.
- L192 `turns_from(messages: Sequence[Mapping[str, Any]])` (function) — AG-UI `Message[]` as model turns, with the speaker kept in the text.
- L217 `_context_value(run_input: Mapping[str, Any], description: str)` (function)
- L226 `stream(run_input: Mapping[str, Any], persona: Persona)` (function) — Run the agent, yielding AG-UI events.
