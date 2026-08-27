---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:43'
updated: '2026-08-27T02:15:43'
---

# apps/api/tests/test_agui.py

Symbols in `apps/api/tests/test_agui.py`.

- L54 `frame(**event: Any)` (function)
- L58 `fold_bytes(*chunks: bytes)` (function) — Feed raw bytes through the decoder and the reducer, as the job does.
- L71 `test_a_record_split_across_chunks_is_reassembled()` (function)
- L83 `test_the_wire_uses_screaming_snake_not_the_docs_headings()` (function)
- L97 `test_two_messages_can_interleave()` (function)
- L109 `test_an_unknown_event_type_does_not_kill_the_run()` (function)
- L119 `test_a_stream_that_never_closes_its_message_still_yields_it()` (function)
- L128 `test_content_without_a_start_opens_the_message()` (function)
- L136 `test_reasoning_is_never_posted()` (function)
- L150 `test_an_empty_delta_is_not_an_empty_message()` (function)
- L161 `test_a_long_body_is_split_into_parts_rather_than_truncated()` (function)
- L174 `test_tool_names_become_a_context_block()` (function)
- L187 `test_a_chunk_event_carries_text_like_the_triad_does()` (function)
- L197 `test_a_run_error_is_recorded_and_stops_the_run()` (function)
- L208 `test_an_interrupt_becomes_a_question_not_an_error()` (function)
- L220 `test_the_run_input_is_camel_case_and_complete()` (function)
- L230 `test_history_casts_the_listening_bot_as_the_assistant()` (function)
- L254 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L264 `team(client: Client)` (function)
- L271 `install(owner: Client, **overrides: object)` (function)
- L277 `agent_speaks(*chunks: bytes, status: int=200)` (function) — A fake AG-UI agent, plus the requests it was sent.
- L297 `route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport)` (function)
- L309 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L318 `messages_in(channel_id: str)` (function)
- L343 `TestRoundTrip` (class)
- L344 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L359 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L376 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L395 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L412 `test_a_bot_message_never_triggers_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L429 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L446 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L461 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L486 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L500 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L518 `TestRegistration` (class)
- L519 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L523 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L530 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
- L539 `TestPrivateEndpoints` (class) — An agent one hop away should not need public DNS and a certificate.
- L550 `test_a_private_endpoint_is_refused_by_default(self, team: dict)` (method)
- L558 `test_the_operator_can_allow_one(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L574 `test_nonsense_is_still_refused_when_allowed(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L589 `sse_frame(event: dict[str, Any])` (function)
- L594 `TestRunCards` (class) — The live card: step/tool events become agent_run.* broadcasts and a stored card.
- L597 `test_a_run_broadcasts_started_and_finished_with_the_card(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L629 `test_the_listing_is_channel_scoped(self, team: dict)` (method)
- L640 `TestCancel` (class)
- L641 `test_a_cancel_before_the_run_starts_wins(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L679 `test_the_cancel_route_is_workspace_scoped(self, team: dict)` (method)
