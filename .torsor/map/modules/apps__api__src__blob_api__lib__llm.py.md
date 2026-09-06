---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/lib/llm.py

Symbols in `apps/api/src/blob_api/lib/llm.py`.

- L54 `LlmError` (class) — No model is configured, or the provider refused.
- L63 `Turn` (class) — One message in the conversation handed to the model.
- L70 `open_client()` (function) — The HTTP client this module talks to a provider with.
- L85 `configured()` (function)
- L89 `model_name()` (function)
- L93 `stream_reply(*, system: str, turns: Sequence[Turn], max_tokens: int | None=None)` (function) — Yield the reply as it is written.
- L114 `_collapse(turns: Sequence[Turn])` (function) — Alternate strictly between user and assistant, merging runs.
- L139 `_stream_sse(url: str, headers: Mapping[str, str], body: dict[str, object])` (function) — POST and yield decoded SSE payloads, with the provider's own error text kept.
- L167 `_anthropic(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L197 `_openai(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L226 `_provider_error(event: Mapping[str, object])` (function)
- L236 `ProviderRefusedError` (class) — The provider answered with an HTTP error. Carries the status and its own words.
- L244 `__init__(self, status: int, detail: str)` (method)
- L250 `complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None=None)` (function) — One reply, whole — for a summary, not a conversation.
- L291 `extract_json(text: str)` (function) — The one JSON object in a model's reply, fences and preamble tolerated.
- L314 `_post_json(url: str, headers: Mapping[str, str], body: Mapping[str, object], *, timeout_sec: float)` (function) — POST once and return the decoded body, with the same failure vocabulary as the stream.
- L344 `_refused_the_hint(refused: ProviderRefusedError)` (function)
- L348 `_anthropic_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
- L400 `_openai_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
