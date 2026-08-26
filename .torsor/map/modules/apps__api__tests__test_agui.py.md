---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/tests/test_agui.py

Symbols in `apps/api/tests/test_agui.py`.

- L52 `frame(**event: Any)` (function)
- L56 `fold_bytes(*chunks: bytes)` (function) — Feed raw bytes through the decoder and the reducer, as the job does.
- L69 `test_a_record_split_across_chunks_is_reassembled()` (function)
- L81 `test_the_wire_uses_screaming_snake_not_the_docs_headings()` (function)
- L95 `test_two_messages_can_interleave()` (function)
- L107 `test_an_unknown_event_type_does_not_kill_the_run()` (function)
- L117 `test_a_stream_that_never_closes_its_message_still_yields_it()` (function)
- L126 `test_content_without_a_start_opens_the_message()` (function)
- L134 `test_reasoning_is_never_posted()` (function)
- L148 `test_an_empty_delta_is_not_an_empty_message()` (function)
- L159 `test_a_long_body_is_split_into_parts_rather_than_truncated()` (function)
- L172 `test_tool_names_become_a_context_block()` (function)
- L185 `test_a_chunk_event_carries_text_like_the_triad_does()` (function)
- L195 `test_a_run_error_is_recorded_and_stops_the_run()` (function)
- L206 `test_an_interrupt_becomes_a_question_not_an_error()` (function)
- L218 `test_the_run_input_is_camel_case_and_complete()` (function)
- L228 `test_history_casts_the_listening_bot_as_the_assistant()` (function)
- L252 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L262 `team(client: Client)` (function)
- L269 `install(owner: Client, **overrides: object)` (function)
- L275 `agent_speaks(*chunks: bytes, status: int=200)` (function) — A fake AG-UI agent, plus the requests it was sent.
- L295 `route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport)` (function)
- L305 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L314 `messages_in(channel_id: str)` (function)
- L339 `TestRoundTrip` (class)
- L340 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L355 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L372 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L391 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L408 `test_a_bot_message_never_triggers_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L425 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L442 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L457 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L482 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L496 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L514 `TestRegistration` (class)
- L515 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L519 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L526 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
- L535 `TestPrivateEndpoints` (class) — An agent one hop away should not need public DNS and a certificate.
- L546 `test_a_private_endpoint_is_refused_by_default(self, team: dict)` (method)
- L554 `test_the_operator_can_allow_one(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L570 `test_nonsense_is_still_refused_when_allowed(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
