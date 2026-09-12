---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_llm_tools_anthropic.py

Symbols in `apps/api/tests/test_llm_tools_anthropic.py`.

- L24 `sse(*events: dict[str, Any])` (function)
- L28 `streamed(*events: dict[str, Any])` (function)
- L45 `tool_use_events(call_id: str, name: str, arguments: dict[str, Any])` (function)
- L70 `text_events(*pieces: str)` (function)
- L89 `anthropic(monkeypatch: pytest.MonkeyPatch)` (function)
- L102 `collect(**kwargs: Any)` (function)
- L106 `test_a_tool_call_is_run_and_its_result_handed_back(anthropic: dict[str, Any])` (function)
- L160 `test_an_error_event_mid_loop_carries_its_message(anthropic: dict[str, Any])` (function)
- L180 `test_a_model_that_never_stops_calling_hits_the_round_limit(anthropic: dict[str, Any])` (function)
