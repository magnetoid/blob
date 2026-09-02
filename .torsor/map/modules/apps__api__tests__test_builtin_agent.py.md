---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
---

# apps/api/tests/test_builtin_agent.py

Symbols in `apps/api/tests/test_builtin_agent.py`.

- L34 `sse(*events: dict[str, Any])` (function)
- L38 `anthropic_says(*texts: str, status: int=200, body: bytes=b'')` (function) — A fake Anthropic streaming endpoint.
- L54 `model(monkeypatch: pytest.MonkeyPatch)` (function) — A configured model whose answer the test chooses.
- L75 `collect(run_input: dict, persona: builtin.Persona)` (function)
- L79 `run_input(*messages: dict[str, Any], channel: str='general')` (function)
- L91 `TestTheConversationHandedToTheModel` (class)
- L92 `test_the_speaker_survives_into_the_text(self)` (method)
- L105 `test_a_channel_is_flattened_into_an_alternating_conversation(self)` (method)
- L118 `test_a_conversation_cannot_open_with_the_agent(self)` (method)
- L130 `TestTheEventStream` (class)
- L131 `test_an_answer_is_a_well_formed_agui_run(self, model: dict)` (method)
- L145 `test_a_refusal_becomes_run_error_not_an_exception(self, model: dict)` (method)
- L155 `test_nothing_is_started_before_the_first_token(self, model: dict)` (method)
- L163 `test_a_silent_model_finishes_cleanly(self, model: dict)` (method)
- L172 `test_no_model_is_a_reason_rather_than_a_traceback(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L183 `TestWhatItIsTold` (class)
- L184 `test_it_is_told_it_has_no_tools(self)` (method)
- L193 `test_a_personal_agent_gets_a_different_room_described_to_it(self)` (method)
- L206 `TestItIsAPluginLikeAnyOther` (class)
- L207 `test_a_manifest_cannot_claim_the_builtin_runtime(self, team: dict)` (method)
- L223 `test_it_is_seeded_into_a_new_workspace(self, model: dict, client: Client)` (method)
- L231 `test_it_is_in_the_public_channels_already(self, model: dict, client: Client)` (method)
- L242 `test_nothing_is_seeded_without_a_model(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L252 `test_seeding_twice_installs_once(self, model: dict, client: Client)` (method)
- L274 `TestAnsweringInAChannel` (class)
- L275 `test_it_answers_when_mentioned(self, model: dict, client: Client)` (method)
- L286 `test_the_run_is_logged_as_running_here(self, model: dict, client: Client)` (method)
- L302 `test_a_disabled_agent_stops_answering(self, model: dict, client: Client)` (method)
