---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_llm_deepseek.py

Symbols in `apps/api/tests/test_llm_deepseek.py`.

- L34 `answers(content: str)` (function)
- L51 `streams(*chunks: str)` (function)
- L66 `deepseek(monkeypatch: pytest.MonkeyPatch)` (function)
- L76 `TestConfiguration` (class)
- L77 `test_a_key_alone_configures_it(self, deepseek: dict[str, Any])` (method)
- L80 `test_the_default_model_is_deepseek_chat(self, deepseek: dict[str, Any])` (method)
- L83 `test_an_explicit_model_still_wins(self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L90 `TestRouting` (class)
- L91 `test_complete_reaches_deepseek_with_no_base_url_set(self, deepseek: dict[str, Any])` (method)
- L103 `test_streaming_reaches_deepseek_too(self, deepseek: dict[str, Any])` (method)
- L109 `test_an_explicit_base_url_still_overrides(self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L119 `test_openai_is_unmoved_by_any_of_this(self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L130 `TestStructuredOutput` (class)
- L131 `test_deepseek_gets_plain_json_mode_not_the_strict_schema(self, deepseek: dict[str, Any])` (method) — DeepSeek answers `{"type": "json_object"}` and 400s on a strict `json_schema`.
- L148 `TestTools` (class)
- L149 `test_tool_calls_use_the_openai_shape_against_deepseek(self, deepseek: dict[str, Any])` (method) — DeepSeek's function calling is OpenAI's, so the OpenAI turn builder is reused.
