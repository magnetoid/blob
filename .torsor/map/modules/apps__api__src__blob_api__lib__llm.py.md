---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/lib/llm.py

Symbols in `apps/api/src/blob_api/lib/llm.py`.

- L76 `_base()` (function) — The host for this request: the operator's override, else the provider's own.
- L81 `_takes_strict_json_schema()` (function) — Whether this endpoint understands `response_format: {"type": "json_schema"}`.
- L94 `LlmError` (class) — No model is configured, or the provider refused.
- L103 `Turn` (class) — One message in the conversation handed to the model.
- L111 `ToolCall` (class) — The model asked for a tool.
- L124 `ToolResult` (class) — What the tool said, yielded as soon as it said it.
- L142 `open_client()` (function) — The HTTP client this module talks to a provider with.
- L157 `configured()` (function)
- L161 `model_name()` (function)
- L165 `stream_reply(*, system: str, turns: Sequence[Turn], max_tokens: int | None=None)` (function) — Yield the reply as it is written.
- L186 `_collapse(turns: Sequence[Turn])` (function) — Alternate strictly between user and assistant, merging runs.
- L211 `_stream_sse(url: str, headers: Mapping[str, str], body: dict[str, object])` (function) — POST and yield decoded SSE payloads, with the provider's own error text kept.
- L239 `_anthropic(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L269 `_openai(*, system: str, turns: Sequence[Turn], max_tokens: int)` (function)
- L298 `_provider_error(event: Mapping[str, object])` (function)
- L308 `stream_reply_with_tools(*, system: str, turns: Sequence[Turn], tools: Sequence[Mapping[str, Any]], call: ToolRunner, max_tokens: int | None=None, max_rounds: int=6)` (function) — Yield the reply as it is written, running the tools the model asks for.
- L410 `_tool_arguments(raw: str)` (function) — The accumulated argument fragments, as the object the tool is called with.
- L429 `_anthropic_tool_turn(*, system: str, messages: Sequence[Mapping[str, Any]], tools: Sequence[Mapping[str, Any]], max_tokens: int)` (function) — One model turn. Text deltas as they arrive; a `ToolCall` when its block closes.
- L489 `_openai_tool_turn(*, system: str, messages: Sequence[Mapping[str, Any]], tools: Sequence[Mapping[str, Any]], max_tokens: int)` (function) — One model turn. Text deltas as they arrive; every `ToolCall` once the stream ends.
- L567 `ProviderRefusedError` (class) — The provider answered with an HTTP error. Carries the status and its own words.
- L575 `__init__(self, status: int, detail: str)` (method)
- L581 `complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None=None)` (function) — One reply, whole — for a summary, not a conversation.
- L622 `extract_json(text: str)` (function) — The one JSON object in a model's reply, fences and preamble tolerated.
- L645 `_post_json(url: str, headers: Mapping[str, str], body: Mapping[str, object], *, timeout_sec: float)` (function) — POST once and return the decoded body, with the same failure vocabulary as the stream.
- L675 `_refused_the_hint(refused: ProviderRefusedError)` (function)
- L679 `_anthropic_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
- L731 `_openai_complete(*, system: str, turns: Sequence[Turn], max_tokens: int, timeout_sec: float, json_schema: Mapping[str, Any] | None)` (function)
