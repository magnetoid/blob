---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_llm_tools.py

Symbols in `apps/api/tests/test_llm_tools.py`.

- L24 `sse(*events: dict[str, Any])` (function)
- L28 `streamed(*events: dict[str, Any])` (function)
- L45 `openai_tool_then_text(tool_name: str, arguments: dict[str, Any], answer: str)` (function) — A provider that asks for one tool on the first request and answers on the second.
- L99 `openai(monkeypatch: pytest.MonkeyPatch)` (function)
- L112 `collect(**kwargs: Any)` (function)
- L116 `test_a_tool_call_is_run_and_its_result_handed_back(openai: dict[str, Any])` (function)
- L148 `test_tools_are_declared_in_the_providers_shape(openai: dict[str, Any])` (function)
- L168 `test_a_model_that_never_stops_calling_hits_the_round_limit(openai: dict[str, Any])` (function)
- L206 `test_a_provider_error_mid_loop_carries_its_message(openai: dict[str, Any])` (function)
- L243 `test_no_tools_means_the_plain_reply(openai: dict[str, Any])` (function) — With an empty tool list the loop is `stream_reply`: no tools key, text only.
- L259 `test_a_result_is_yielded_the_moment_its_tool_returns(openai: dict[str, Any])` (function) — A caller drawing a run card needs the answer, not only the question.
