---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/plugins/builtin.py

Symbols in `apps/api/src/blob_api/plugins/builtin.py`.

- L50 `Persona` (class) — Who this agent is. The one thing that differs between built-in agents.
- L65 `system_prompt(persona: Persona, *, channel_name: str, participants: Sequence[str]=(), asked_by_agent: str | None=None, on_behalf_of: str | None=None, tools: Sequence[Mapping[str, Any]]=())` (function) — What the agent is told before it sees a word of the conversation.
- L101 `_shared_rules(tools: Sequence[Mapping[str, Any]]=())` (function) — The half that does not change between a channel and a DM.
- L117 `_capabilities(tools: Sequence[Mapping[str, Any]])` (function) — The paragraph that has to change the day the agent stops being blind.
- L154 `_channel_prompt(persona: Persona, channel_name: str, *, participants: Sequence[str]=(), asked_by_agent: str | None=None, on_behalf_of: str | None=None, tools: Sequence[Mapping[str, Any]]=())` (function) — A group room, and — when other agents are in it — how to work with them.
- L204 `_personal_prompt(persona: Persona, owner_name: str, *, tools: Sequence[Mapping[str, Any]]=())` (function) — A private, one-to-one room, and it has to be described as one.
- L249 `turns_from(messages: Sequence[Mapping[str, Any]])` (function) — AG-UI `Message[]` as model turns, with the speaker kept in the text.
- L274 `_context_value(run_input: Mapping[str, Any], description: str)` (function)
- L283 `stream(run_input: Mapping[str, Any], persona: Persona, *, tools: Sequence[Mapping[str, Any]]=(), call: llm.ToolRunner | None=None)` (function) — Run the agent, yielding AG-UI events.
