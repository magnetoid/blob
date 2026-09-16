---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T15:52:02'
updated: '2026-09-16T15:52:02'
---

# apps/api/tests/test_llm_anthropic_stream.py

Symbols in `apps/api/tests/test_llm_anthropic_stream.py`.

- L23 `sse(*events: dict[str, Any])` (function)
- L27 `streaming(*events: dict[str, Any])` (function)
- L32 `anthropic(monkeypatch: pytest.MonkeyPatch)` (function) — The provider turned on, and `llm.open_client` — the seam the module owns — pointed
- L47 `TestStreaming` (class)
- L48 `test_text_deltas_are_yielded_and_nothing_else(self, anthropic: dict[str, Any])` (method)
- L84 `test_an_error_event_after_a_200_is_a_refusal_not_silence(self, anthropic: dict[str, Any])` (method)
