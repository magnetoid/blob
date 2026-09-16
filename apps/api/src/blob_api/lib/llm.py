"""A model, for the two features of Blob's own that need one.

The agent a workspace gets is Janus, and it brings its own model — this is not that.
It is deliberately the smallest possible provider layer, with two callers:
`services/catchup.py` (the unread recap) and `services/agentic.py` (thread summaries).
Blob is not becoming an LLM framework: it needs two calls — stream a reply to a
conversation, and complete one document whole — and everything else that makes agents
interesting (history, identity, permissions, what gets posted where) is already Blob's
and stays Blob's.

**Streaming for conversation, `complete` for documents.** `stream_reply` yields the reply
as the provider writes it, reading the provider's SSE with `lib/sse.py` rather than a
second parser — it is the same wire format AG-UI uses. The recap joins the deltas into one
string before it answers, so nothing shows them today; the shape is what a caller that
wants a reply to appear as it is written needs, and it costs nothing to keep. A summary is
different: nobody reads it as it is typed, it has to parse as JSON, and a stream that stops
early is indistinguishable from one that finished. `complete` reads the provider's *stop
reason* and turns "ran out of room" and "declined" into typed errors instead of a fragment
that looks like an answer.

**Disabled is a first-class state, not an error path.** Self-hosted Blob with no API key
is a completely reasonable deployment — both production instances run that way — and the
promise is that a workspace stays up. So `configured` is checked before anything is
offered in the UI, and a call that gets here anyway returns a sentence a person can act
on rather than a traceback.
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import settings
from .sse import SseDecoder

#: Sent to Anthropic. Their API refuses an unknown version outright, so this is pinned
#: rather than read from configuration — a deployment cannot usefully choose it.
ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "openai": "gpt-4.1",
    # `deepseek-chat` until 2026-09-14, when DeepSeek stopped serving it. It does not
    # 404: the API answers 200 and then never sends a body, so a run hung until
    # LLM_READ_TIMEOUT_SEC and failed with nothing to explain it. `/v1/models` is the
    # thing to ask when an agent goes quiet — it lists what the account can actually
    # call, which is the charter's "find out what the current answer is" in one request.
    "deepseek": "deepseek-v4-pro",
}

#: Where each provider lives when the operator has not said otherwise.
#:
#: This table exists because "no `LLM_BASE_URL` means OpenAI" stopped being true. With
#: two providers the host could be a literal at each call site and the only question a
#: base URL answered was "is this a compatible server standing in for OpenAI". DeepSeek
#: is the case that breaks it: OpenAI-shaped, its own host, and no override set. The
#: provider is the thing that knows where to send, so it is the thing that is asked.
DEFAULT_BASES = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
    "deepseek": "https://api.deepseek.com",
}


def _base() -> str:
    """The host for this request: the operator's override, else the provider's own."""
    return (settings.LLM_BASE_URL or DEFAULT_BASES.get(settings.LLM_PROVIDER, "")).rstrip("/")


def _takes_strict_json_schema() -> bool:
    """Whether this endpoint understands `response_format: {"type": "json_schema"}`.

    OpenAI proper does. DeepSeek does not — it answers plain `json_object` and 400s on
    the strict form. Neither does an arbitrary compatible server behind `LLM_BASE_URL`,
    which is why an override still means "assume the simpler hint". `complete` retries
    once without the hint when a server refuses it, so the cost of guessing wrong is a
    wasted round trip on *every* call, not a failure — which is exactly the kind of thing
    that never gets noticed.
    """
    return settings.LLM_PROVIDER == "openai" and settings.LLM_BASE_URL is None


class LlmError(Exception):
    """No model is configured, or the provider refused.

    Carries a sentence meant for a person, because that is where it ends up: Catch-up
    answers with it (`services/catchup.py`, as `llm_failed`), and a thread summary falls
    back to the keyword scan and labels itself as such (`services/agentic.py`).
    """


@dataclass(slots=True)
class Turn:
    """One message in the conversation handed to the model."""

    role: str
    content: str


def open_client() -> httpx.AsyncClient:
    """The HTTP client this module talks to a provider with.

    A named seam, and it exists so that a test can substitute a transport by patching a
    name *this module owns*. Patching `httpx.AsyncClient` instead reaches the one module
    object every importer shares — including the test suite's own client, which is built
    from `httpx.AsyncClient` too, so the fake meant for the model provider ends up
    answering the requests to the app under test. That failure is silent and reads as a
    bug in the feature. `test_agui.route_agent_to` has a related shape recorded in the
    traps list; this is the version that cannot happen.
    """
    timeout = httpx.Timeout(settings.LLM_TIMEOUT_SEC, read=settings.LLM_READ_TIMEOUT_SEC)
    return httpx.AsyncClient(timeout=timeout)


def configured() -> bool:
    return settings.LLM_PROVIDER != "disabled" and bool(settings.LLM_API_KEY)


def model_name() -> str:
    return settings.LLM_MODEL or DEFAULT_MODELS.get(settings.LLM_PROVIDER, "")


async def stream_reply(
    *, system: str, turns: Sequence[Turn], max_tokens: int | None = None
) -> AsyncIterator[str]:
    """Yield the reply as it is written.

    Text deltas only. Both providers interleave bookkeeping events — token counts, stop
    reasons, content-block boundaries — and none of it is Blob's business: the recap
    joins these into one reply and wants the prose.
    """
    if not configured():
        raise LlmError("no model is configured for this server")

    limit = max_tokens or settings.LLM_MAX_TOKENS
    if settings.LLM_PROVIDER == "anthropic":
        stream = _anthropic(system=system, turns=turns, max_tokens=limit)
    else:
        stream = _openai(system=system, turns=turns, max_tokens=limit)
    async for delta in stream:
        yield delta


def _collapse(turns: Sequence[Turn]) -> list[dict[str, str]]:
    """Alternate strictly between user and assistant, merging runs.

    A channel is not a two-party chat: three people and two bots can speak before the
    agent is mentioned. Anthropic rejects two consecutive messages with the same role
    outright, so consecutive same-role turns are joined with a blank line rather than
    sent as they are — and the *speaker* is preserved in the text by the caller, which is
    what actually carries who said what.
    """
    out: list[dict[str, str]] = []
    for turn in turns:
        if not turn.content.strip():
            continue
        role = "assistant" if turn.role == "assistant" else "user"
        if out and out[-1]["role"] == role:
            out[-1]["content"] = f"{out[-1]['content']}\n\n{turn.content}"
        else:
            out.append({"role": role, "content": turn.content})
    # A conversation that starts with the agent's own words is not one the model can
    # answer; it has to be someone asking. This happens when a bot posts first.
    while out and out[0]["role"] == "assistant":
        out.pop(0)
    return out


async def _stream_sse(
    url: str, headers: Mapping[str, str], body: dict[str, object]
) -> AsyncIterator[dict[str, object]]:
    """POST and yield decoded SSE payloads, with the provider's own error text kept.

    A 400 from a model provider almost always says exactly what is wrong — a bad model
    name, a key without access, a context overflow. Discarding the body and reporting the
    status is how a five-second fix becomes an afternoon, so the first part of it is read
    and carried into the exception.
    """
    decoder = SseDecoder()
    try:
        async with open_client() as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", "replace")[:400]
                    raise LlmError(f"the model provider answered {response.status_code}: {detail}")
                async for chunk in response.aiter_bytes():
                    for event in decoder.feed(chunk):
                        yield event
                for event in decoder.close():
                    yield event
    except httpx.TimeoutException as error:
        raise LlmError("the model did not answer in time") from error
    except httpx.HTTPError as error:
        raise LlmError(f"the model could not be reached: {error}") from error


async def _anthropic(*, system: str, turns: Sequence[Turn], max_tokens: int) -> AsyncIterator[str]:
    messages = _collapse(turns)
    if not messages:
        return
    base = _base()
    body: dict[str, object] = {
        "model": model_name(),
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "stream": True,
    }
    headers = {
        "x-api-key": settings.LLM_API_KEY or "",
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    async for event in _stream_sse(f"{base}/v1/messages", headers, body):
        # `content_block_delta` carries the prose; `message_delta` carries stop reasons
        # and usage. An `error` event can arrive mid-stream after a 200, which is the one
        # failure that would otherwise look like the model simply stopping.
        kind = event.get("type")
        if kind == "content_block_delta":
            delta = event.get("delta")
            if isinstance(delta, dict) and isinstance(delta.get("text"), str):
                yield delta["text"]
        elif kind == "error":
            raise LlmError(_provider_error(event))


async def _openai(*, system: str, turns: Sequence[Turn], max_tokens: int) -> AsyncIterator[str]:
    messages = [{"role": "system", "content": system}, *_collapse(turns)]
    if len(messages) == 1:
        return
    base = _base()
    body: dict[str, object] = {
        "model": model_name(),
        "max_tokens": max_tokens,
        "messages": messages,
        "stream": True,
    }
    headers = {
        "authorization": f"Bearer {settings.LLM_API_KEY or ''}",
        "content-type": "application/json",
    }
    async for event in _stream_sse(f"{base}/v1/chat/completions", headers, body):
        if event.get("error"):
            raise LlmError(_provider_error(event))
        choices = event.get("choices")
        if not isinstance(choices, list) or not choices:
            continue
        first = choices[0]
        if not isinstance(first, dict):
            continue
        delta = first.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("content"), str):
            yield delta["content"]


def _provider_error(event: Mapping[str, object]) -> str:
    error = event.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return f"the model refused: {error['message']}"
    return f"the model refused: {json.dumps(event)[:200]}"


# --- one whole reply -----------------------------------------------------------------


class ProviderRefusedError(LlmError):
    """The provider answered with an HTTP error. Carries the status and its own words.

    A subclass rather than a flag so that `complete` can tell "the request shape was
    refused" (retry once without the structured-output hint) from "the model could not
    be reached" (do not), and callers that only want a sentence still get one.
    """

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"the model provider answered {status}: {detail}")
        self.status = status
        self.detail = detail


async def complete(
    *,
    system: str,
    turns: Sequence[Turn],
    max_tokens: int,
    timeout_sec: float,
    json_schema: Mapping[str, Any] | None = None,
) -> str:
    """One reply, whole — for a summary, not a conversation.

    `max_tokens` is a hard cap that on current Anthropic models covers the model's
    *thinking* as well as its text, so size it for the document plus real headroom (the
    thread summary uses 4096 for at most ~1200 tokens of JSON), never for the document
    alone. `timeout_sec` bounds the whole call: with no stream there is no first byte
    until the model has finished, so the streaming read timeout would be the wrong knob.
    `json_schema` asks the provider to shape its output (Anthropic `output_config.format`,
    OpenAI `response_format`); a provider that refuses the hint with a 400 is asked once
    more without it, because OpenAI-compatible servers behind `LLM_BASE_URL` know these
    fields unevenly and the caller's parser is the guarantee either way. The system prompt
    should still say "JSON" — OpenAI's plain JSON mode refuses a request whose messages
    never mention it.
    """
    if not configured():
        raise LlmError("no model is configured for this server")
    if settings.LLM_PROVIDER == "anthropic":
        return await _anthropic_complete(
            system=system,
            turns=turns,
            max_tokens=max_tokens,
            timeout_sec=timeout_sec,
            json_schema=json_schema,
        )
    return await _openai_complete(
        system=system,
        turns=turns,
        max_tokens=max_tokens,
        timeout_sec=timeout_sec,
        json_schema=json_schema,
    )


def extract_json(text: str) -> dict[str, Any]:
    """The one JSON object in a model's reply, fences and preamble tolerated.

    Even with a schema hint some servers wrap the object in a code fence or a sentence.
    What is not tolerated is *no* object: that is a typed failure, not an empty summary.
    """
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[A-Za-z]*\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end < start:
        raise LlmError("the model did not answer in the expected shape")
    try:
        data = json.loads(stripped[start : end + 1])
    except ValueError as error:
        raise LlmError("the model did not answer in the expected shape") from error
    if not isinstance(data, dict):
        raise LlmError("the model did not answer in the expected shape")
    return data


async def _post_json(
    url: str, headers: Mapping[str, str], body: Mapping[str, object], *, timeout_sec: float
) -> dict[str, Any]:
    """POST once and return the decoded body, with the same failure vocabulary as the stream."""
    try:
        async with open_client() as client:
            response = await client.post(
                url,
                json=body,
                headers=headers,
                timeout=httpx.Timeout(timeout_sec, connect=10.0),
            )
    except httpx.TimeoutException as error:
        raise LlmError("the model did not answer in time") from error
    except httpx.HTTPError as error:
        raise LlmError(f"the model could not be reached: {error}") from error
    if response.status_code >= 400:
        raise ProviderRefusedError(response.status_code, response.text[:400])
    try:
        data = response.json()
    except ValueError as error:
        raise LlmError("the model provider answered with something that was not JSON") from error
    if not isinstance(data, dict):
        raise LlmError("the model provider answered with something that was not JSON")
    return data


_HINT_WORDS = ("output_config", "response_format", "json_schema", "structured", "format")


def _refused_the_hint(refused: ProviderRefusedError) -> bool:
    return refused.status == 400 and any(word in refused.detail for word in _HINT_WORDS)


async def _anthropic_complete(
    *,
    system: str,
    turns: Sequence[Turn],
    max_tokens: int,
    timeout_sec: float,
    json_schema: Mapping[str, Any] | None,
) -> str:
    messages = _collapse(turns)
    if not messages:
        return ""
    base = _base()
    body: dict[str, object] = {
        "model": model_name(),
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if json_schema is not None:
        body["output_config"] = {"format": {"type": "json_schema", "schema": dict(json_schema)}}
    headers = {
        "x-api-key": settings.LLM_API_KEY or "",
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    url = f"{base}/v1/messages"
    try:
        data = await _post_json(url, headers, body, timeout_sec=timeout_sec)
    except ProviderRefusedError as refused:
        if json_schema is None or not _refused_the_hint(refused):
            raise
        body.pop("output_config", None)
        data = await _post_json(url, headers, body, timeout_sec=timeout_sec)
    if data.get("type") == "error":
        raise LlmError(_provider_error(data))
    stop = data.get("stop_reason")
    if stop == "max_tokens":
        raise LlmError("the model ran out of room before it finished")
    if stop == "refusal":
        raise LlmError("the model declined to answer")
    content = data.get("content")
    if not isinstance(content, list):
        return ""
    return "".join(
        block["text"]
        for block in content
        if isinstance(block, dict)
        and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    )


async def _openai_complete(
    *,
    system: str,
    turns: Sequence[Turn],
    max_tokens: int,
    timeout_sec: float,
    json_schema: Mapping[str, Any] | None,
) -> str:
    messages = [{"role": "system", "content": system}, *_collapse(turns)]
    if len(messages) == 1:
        return ""
    base = _base()
    body: dict[str, object] = {
        "model": model_name(),
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if json_schema is not None:
        # Real OpenAI takes the strict schema; DeepSeek and a compatible server behind
        # LLM_BASE_URL know plain JSON mode, and unevenly at that — see the retry below.
        if _takes_strict_json_schema():
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "reply", "strict": True, "schema": dict(json_schema)},
            }
        else:
            body["response_format"] = {"type": "json_object"}
    headers = {
        "authorization": f"Bearer {settings.LLM_API_KEY or ''}",
        "content-type": "application/json",
    }
    url = f"{base}/v1/chat/completions"
    try:
        data = await _post_json(url, headers, body, timeout_sec=timeout_sec)
    except ProviderRefusedError as refused:
        # Two shapes of "not like that": the structured-output hint (compatible servers),
        # and `max_tokens`, which OpenAI's reasoning families reject in favour of
        # `max_completion_tokens`. One more try, with the offending field changed.
        retry = False
        if json_schema is not None and _refused_the_hint(refused):
            body.pop("response_format", None)
            retry = True
        if refused.status == 400 and "max_completion_tokens" in refused.detail:
            body["max_completion_tokens"] = body.pop("max_tokens")
            retry = True
        if not retry:
            raise
        data = await _post_json(url, headers, body, timeout_sec=timeout_sec)
    if data.get("error"):
        raise LlmError(_provider_error(data))
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return ""
    first = choices[0]
    finish = first.get("finish_reason")
    if finish == "length":
        raise LlmError("the model ran out of room before it finished")
    if finish == "content_filter":
        raise LlmError("the model declined to answer")
    message = first.get("message")
    if isinstance(message, dict) and message.get("refusal"):
        raise LlmError("the model declined to answer")
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        return message["content"]
    return ""


__all__ = [
    "LlmError",
    "ProviderRefusedError",
    "Turn",
    "complete",
    "configured",
    "extract_json",
    "model_name",
    "stream_reply",
]
