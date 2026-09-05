---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/tests/test_agui.py

Symbols in `apps/api/tests/test_agui.py`.

- L53 `frame(**event: Any)` (function)
- L57 `fold_bytes(*chunks: bytes)` (function) — Feed raw bytes through the decoder and the reducer, as the job does.
- L70 `test_a_record_split_across_chunks_is_reassembled()` (function)
- L82 `test_the_wire_uses_screaming_snake_not_the_docs_headings()` (function)
- L96 `test_two_messages_can_interleave()` (function)
- L108 `test_an_unknown_event_type_does_not_kill_the_run()` (function)
- L118 `test_a_stream_that_never_closes_its_message_still_yields_it()` (function)
- L127 `test_content_without_a_start_opens_the_message()` (function)
- L135 `test_reasoning_is_never_posted()` (function)
- L149 `test_an_empty_delta_is_not_an_empty_message()` (function)
- L160 `test_a_long_body_is_split_into_parts_rather_than_truncated()` (function)
- L173 `test_tool_names_become_a_context_block()` (function)
- L186 `test_a_chunk_event_carries_text_like_the_triad_does()` (function)
- L196 `test_a_run_error_is_recorded_and_stops_the_run()` (function)
- L207 `test_an_interrupt_becomes_a_question_not_an_error()` (function)
- L221 `test_the_run_input_is_camel_case_and_complete()` (function)
- L235 `test_history_casts_the_listening_bot_as_the_assistant()` (function)
- L259 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L269 `team(client: Client)` (function)
- L276 `install(owner: Client, **overrides: object)` (function)
- L282 `agent_speaks(*chunks: bytes, status: int=200)` (function) — A fake AG-UI agent, plus the requests it was sent.
- L302 `route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport)` (function)
- L314 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L323 `messages_in(channel_id: str)` (function)
- L348 `TestRoundTrip` (class)
- L349 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L364 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L381 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L400 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L417 `test_a_bot_api_post_never_starts_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L436 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L453 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L468 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L493 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L507 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L525 `TestRegistration` (class)
- L526 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L530 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L537 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
- L546 `TestPrivateEndpoints` (class) — An agent one hop away should not need public DNS and a certificate.
- L557 `test_a_private_endpoint_is_refused_by_default(self, team: dict)` (method)
- L565 `test_the_operator_can_allow_one(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L581 `test_nonsense_is_still_refused_when_allowed(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L596 `sse_frame(event: dict[str, Any])` (function)
- L601 `TestRunCards` (class) — The live card: step/tool events become agent_run.* broadcasts and a stored card.
- L604 `test_a_run_broadcasts_started_and_finished_with_the_card(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L634 `test_the_listing_is_channel_scoped(self, team: dict)` (method)
- L643 `TestCancel` (class)
- L644 `test_a_cancel_before_the_run_starts_wins(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L680 `test_the_cancel_route_is_workspace_scoped(self, team: dict)` (method)
- L685 `TestBudget` (class) — The dam: a mention that arrives over budget is refused, visibly, unrun.
- L693 `test_a_mention_over_the_run_budget_is_refused_and_the_agent_never_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L724 `test_the_seconds_budget_counts_time_not_runs(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L756 `test_old_runs_and_refusals_cost_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
