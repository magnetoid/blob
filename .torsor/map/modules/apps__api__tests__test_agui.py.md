---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/tests/test_agui.py

Symbols in `apps/api/tests/test_agui.py`.

- L52 `frame(**event: Any)` (function)
- L56 `fold_bytes(*chunks: bytes)` (function) — Feed raw bytes through the decoder and the reducer, as the job does.
- L69 `test_a_record_split_across_chunks_is_reassembled()` (function)
- L79 `test_the_wire_uses_screaming_snake_not_the_docs_headings()` (function)
- L90 `test_two_messages_can_interleave()` (function)
- L102 `test_an_unknown_event_type_does_not_kill_the_run()` (function)
- L112 `test_a_stream_that_never_closes_its_message_still_yields_it()` (function)
- L121 `test_content_without_a_start_opens_the_message()` (function)
- L129 `test_reasoning_is_never_posted()` (function)
- L140 `test_an_empty_delta_is_not_an_empty_message()` (function)
- L148 `test_a_long_body_is_split_into_parts_rather_than_truncated()` (function)
- L161 `test_tool_names_become_a_context_block()` (function)
- L174 `test_a_chunk_event_carries_text_like_the_triad_does()` (function)
- L181 `test_a_run_error_is_recorded_and_stops_the_run()` (function)
- L192 `test_an_interrupt_becomes_a_question_not_an_error()` (function)
- L204 `test_the_run_input_is_camel_case_and_complete()` (function)
- L214 `test_history_casts_the_listening_bot_as_the_assistant()` (function)
- L234 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L244 `team(client: Client)` (function)
- L251 `install(owner: Client, **overrides: object)` (function)
- L257 `agent_speaks(*chunks: bytes, status: int=200)` (function) — A fake AG-UI agent, plus the requests it was sent.
- L277 `route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport)` (function)
- L287 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L296 `messages_in(channel_id: str)` (function)
- L321 `TestRoundTrip` (class)
- L322 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L337 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L354 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L373 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L390 `test_a_bot_message_never_triggers_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L407 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L424 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L439 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L464 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L478 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L496 `TestRegistration` (class)
- L497 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L501 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L508 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
- L517 `TestPrivateEndpoints` (class) — An agent one hop away should not need public DNS and a certificate.
- L528 `test_a_private_endpoint_is_refused_by_default(self, team: dict)` (method)
- L536 `test_the_operator_can_allow_one(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L552 `test_nonsense_is_still_refused_when_allowed(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
