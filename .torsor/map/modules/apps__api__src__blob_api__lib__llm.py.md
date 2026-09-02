---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:19'
updated: '2026-09-02T05:49:19'
---

# apps/api/src/blob_api/lib/llm.py

Symbols in `apps/api/src/blob_api/lib/llm.py`.

- L46 `LlmError` (class) — No model is configured, or the provider refused.
- L55 `Turn` (class) — One message in the conversation handed to the model.
- L62 `open_client()` (function) — The HTTP client this module talks to a provider with.
- L77 `configured()` (function)
- L81 `model_name()` (function)
- L85 `stream_reply(*, system: str, turns: Sequence[Turn], max_tokens: int | None=None)` (function) — Yield the reply as it is written.
- L106 `_collapse(turns: Sequence[Turn])` (function) — Alternate strictly between user and assistant, merging runs.
- L131 `_stream_sse(url: str, headers: Mapping[str, str], body: dict[str, object])` (function) — POST and yield decoded SSE payloads, with the provider's own error text kept.
- L159 `_anthropic(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L189 `_openai(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L218 `_provider_error(event: Mapping[str, object])` (function)
