---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:22:00'
updated: '2026-09-06T18:22:00'
---

# apps/api/tests/test_llm_complete.py

Symbols in `apps/api/tests/test_llm_complete.py`.

- L15 `openai_answers(content: str, *, finish_reason: str='stop', refuse_hint_once: bool=False)` (function)
- L44 `openai(monkeypatch: pytest.MonkeyPatch)` (function)
- L62 `TestExtractJson` (class)
- L63 `test_fences_and_preamble_are_tolerated(self)` (method)
- L67 `test_no_object_is_a_typed_failure(self)` (method)
- L76 `TestOpenAi` (class)
- L77 `test_real_openai_gets_the_strict_schema(self, openai: dict[str, Any])` (method)
- L88 `test_a_compatible_server_gets_plain_json_mode(self, openai: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L98 `test_a_server_that_refuses_the_hint_is_asked_once_more_without_it(self, openai: dict[str, Any])` (method)
- L109 `test_running_out_of_room_is_an_error_not_a_fragment(self, openai: dict[str, Any])` (method)
- L116 `test_reasoning_models_get_max_completion_tokens_on_the_second_try(self, openai: dict[str, Any])` (method)
- L144 `test_a_strict_schema_refusal_is_declined_not_misshapen(self, openai: dict[str, Any])` (method)
- L164 `test_nothing_configured_is_an_error_before_any_request(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L171 `test_streaming_is_untouched(self, openai: dict[str, Any])` (method)
