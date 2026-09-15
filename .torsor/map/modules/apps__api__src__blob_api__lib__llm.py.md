---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/src/blob_api/lib/llm.py

Symbols in `apps/api/src/blob_api/lib/llm.py`.

- L70 `_base()` (function) — The host for this request: the operator's override, else the provider's own.
- L75 `_takes_strict_json_schema()` (function) — Whether this endpoint understands `response_format: {"type": "json_schema"}`.
- L88 `LlmError` (class) — No model is configured, or the provider refused.
- L97 `Turn` (class) — One message in the conversation handed to the model.
- L104 `open_client()` (function) — The HTTP client this module talks to a provider with.
- L119 `configured()` (function)
- L123 `model_name()` (function)
- L127 `stream_reply(*, system: str, turns: Sequence[Turn], max_tokens: int | None=None)` (function) — Yield the reply as it is written.
- L148 `_collapse(turns: Sequence[Turn])` (function) — Alternate strictly between user and assistant, merging runs.
- L173 `_stream_sse(url: str, headers: Mapping[str, str], body: dict[str, object])` (function) — POST and yield decoded SSE payloads, with the provider's own error text kept.
- L201 `_anthropic(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L231 `_openai(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L260 `_provider_error(event: Mapping[str, object])` (function)
- L270 `ProviderRefusedError` (class) — The provider answered with an HTTP error. Carries the status and its own words.
- L278 `__init__(self, status: int, detail: str)` (method)
- L284 `complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None=None)` (function) — One reply, whole — for a summary, not a conversation.
- L325 `extract_json(text: str)` (function) — The one JSON object in a model's reply, fences and preamble tolerated.
- L348 `_post_json(url: str, headers: Mapping[str, str], body: Mapping[str, object], *, timeout_sec: float)` (function) — POST once and return the decoded body, with the same failure vocabulary as the stream.
- L378 `_refused_the_hint(refused: ProviderRefusedError)` (function)
- L382 `_anthropic_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
- L434 `_openai_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
