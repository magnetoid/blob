---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:40:20'
updated: '2026-09-15T23:40:20'
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
- L320 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L329 `messages_in(channel_id: str)` (function)
- L354 `TestRoundTrip` (class)
- L355 `test_a_mention_makes_the_agent_answer_in_the_channel(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L370 `test_running_the_job_twice_posts_one_message(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L387 `test_the_request_is_signed_the_way_a_delivery_is(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L406 `test_the_agent_is_given_the_conversation_oldest_first(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L423 `test_a_bot_api_post_never_starts_a_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L442 `test_a_disabled_app_is_not_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L459 `test_a_bot_outside_the_channel_says_nothing_at_all(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L474 `test_a_run_error_tells_the_person_and_records_it(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L499 `test_a_non_2xx_does_not_raise_into_the_worker(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L513 `test_a_silent_run_posts_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L531 `TestRegistration` (class)
- L532 `test_an_app_with_only_an_agui_url_installs(self, team: dict)` (method)
- L536 `test_an_external_app_with_neither_url_is_refused(self, team: dict)` (method)
- L543 `test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict)` (method)
- L552 `TestPrivateEndpoints` (class) — An agent one hop away should not need public DNS and a certificate.
- L563 `test_a_private_endpoint_is_refused_by_default(self, team: dict)` (method)
- L571 `test_the_operator_can_allow_one(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L587 `test_nonsense_is_still_refused_when_allowed(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L602 `sse_frame(event: dict[str, Any])` (function)
- L607 `TestRunCards` (class) — The live card: step/tool events become agent_run.* broadcasts and a stored card.
- L610 `test_a_run_broadcasts_started_and_finished_with_the_card(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L643 `test_the_listing_is_channel_scoped(self, team: dict)` (method)
- L652 `TestCancel` (class)
- L653 `test_a_cancel_before_the_run_starts_wins(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L689 `test_the_cancel_route_is_workspace_scoped(self, team: dict)` (method)
- L694 `TestBudget` (class) — The dam: a mention that arrives over budget is refused, visibly, unrun.
- L702 `test_a_mention_over_the_run_budget_is_refused_and_the_agent_never_called(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L733 `test_the_seconds_budget_counts_time_not_runs(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L765 `test_old_runs_and_refusals_cost_nothing(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L806 `TestKillSwitch` (class) — Workspace-wide agentsEnabled: mentions are refused, the agent is never called.
- L809 `test_a_mention_is_refused_when_agents_are_turned_off(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L831 `test_turning_agents_back_on_lets_the_next_mention_run(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
