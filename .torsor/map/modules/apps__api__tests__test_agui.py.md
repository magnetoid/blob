---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T02:53:15'
updated: '2026-08-22T02:53:15'
---

# apps/api/tests/test_agui.py

Symbols in `apps/api/tests/test_agui.py`.

- L45 `frame(**event: Any)` (function)
- L49 `fold_bytes(*chunks: bytes)` (function) — Feed raw bytes through the decoder and the reducer, as the job does.
- L62 `test_a_record_split_across_chunks_is_reassembled()` (function)
- L72 `test_the_wire_uses_screaming_snake_not_the_docs_headings()` (function)
- L83 `test_two_messages_can_interleave()` (function)
- L95 `test_an_unknown_event_type_does_not_kill_the_run()` (function)
- L105 `test_a_stream_that_never_closes_its_message_still_yields_it()` (function)
- L114 `test_content_without_a_start_opens_the_message()` (function)
- L122 `test_reasoning_is_never_posted()` (function)
- L133 `test_an_empty_delta_is_not_an_empty_message()` (function)
- L141 `test_a_long_body_is_split_into_parts_rather_than_truncated()` (function)
- L154 `test_tool_names_become_a_context_block()` (function)
- L167 `test_a_chunk_event_carries_text_like_the_triad_does()` (function)
- L174 `test_a_run_error_is_recorded_and_stops_the_run()` (function)
- L185 `test_an_interrupt_becomes_a_question_not_an_error()` (function)
- L197 `test_the_run_input_is_camel_case_and_complete()` (function)
- L207 `test_history_casts_the_listening_bot_as_the_assistant()` (function)
- L227 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L237 `team(client: Client)` (function)
- L244 `install(owner: Client, **overrides: object)` (function)
- L250 `agent_speaks(*chunks: bytes, status: int=200)` (function) — A fake AG-UI agent, plus the requests it was sent.
- L270 `route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport)` (function)
- L280 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L289 `messages_in(channel_id: str)` (function)
- L314 `TestRoundTrip` (class)
- L315 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L330 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L347 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L366 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L383 `test_a_bot_message_never_triggers_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L400 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L417 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L432 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L457 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L471 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L489 `TestRegistration` (class)
- L490 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L494 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L501 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
