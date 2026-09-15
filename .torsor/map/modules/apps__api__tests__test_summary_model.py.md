---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/tests/test_summary_model.py

Symbols in `apps/api/tests/test_summary_model.py`.

- L37 `completes(payload: dict[str, Any] | str, *, stop_reason: str='end_turn', first_status: int=200, first_body: bytes=b'')` (function) — A fake Anthropic `/v1/messages` that answers whole and records each request.
- L67 `model(monkeypatch: pytest.MonkeyPatch)` (function)
- L76 `thread(client: Client)` (function)
- L96 `TestTheModelPath` (class)
- L97 `test_the_model_writes_it_and_the_ids_are_resolved_here(self, client: Client, model: dict[str, Any])` (method)
- L139 `test_a_model_that_cites_some_lines_loses_the_uncited_ones(self, client: Client, model: dict[str, Any])` (method)
- L157 `test_a_model_citing_only_numbers_that_are_not_there_loses_those_lines(self, client: Client, model: dict[str, Any])` (method)
- L173 `test_a_thread_with_nothing_to_show_a_model_gets_the_keyword_scan(self, client: Client, model: dict[str, Any])` (method)
- L185 `test_a_model_that_never_cites_keeps_its_lines_uncited(self, client: Client, model: dict[str, Any])` (method)
- L205 `test_garbage_is_a_typed_error_and_the_old_summary_stays(self, client: Client, model: dict[str, Any])` (method)
- L221 `test_running_out_of_room_is_a_typed_error(self, client: Client, model: dict[str, Any])` (method)
- L231 `test_a_provider_that_refuses_the_schema_hint_is_asked_once_more_without_it(self, client: Client, model: dict[str, Any])` (method)
- L246 `test_a_provider_error_that_is_not_about_the_hint_is_not_retried(self, client: Client, model: dict[str, Any])` (method)
- L258 `test_model_summaries_are_metered(self, client: Client, model: dict[str, Any])` (method)
- L266 `test_an_app_gets_the_same_summary(self, client: Client, model: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L290 `TestWithoutAModel` (class)
- L291 `test_the_keyword_scan_still_runs_and_questions_point_at_their_message(self, client: Client)` (method)
- L305 `test_a_summary_stored_before_questions_had_ids_still_reads(self, client: Client)` (method)
- L324 `_message(number: int, body: str, author: str='u1')` (function)
- L335 `TestTheTranscript` (class)
- L336 `test_a_long_thread_keeps_the_root_and_the_recent_and_says_what_it_skipped(self)` (method)
- L345 `test_a_pasted_log_is_clipped_and_system_rows_are_skipped(self)` (method)
