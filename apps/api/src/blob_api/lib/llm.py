"""A model, for the agent Blob runs itself.

Until this existed Blob had no model anywhere. It was an excellent *host* for agents —
manifest, scopes, signed delivery, four runtimes, a run log — and was not one: a fresh
workspace had no agent at all until somebody wrote an AG-UI server, deployed it, and paid
for a key. "Agent-native" was true of the plumbing and not yet of the product.

This is deliberately the smallest possible provider layer, and it is only ever called by
`plugins/builtin.py`. Blob is not becoming an LLM framework: it needs one call — stream a
reply to a conversation — and everything else that makes agents interesting (history,
identity, permissions, what gets posted where) is already Blob's and stays Blob's.

**Streaming, not a single response.** The AG-UI fold downstream is built around deltas,
and a channel where the answer appears as it is written is the difference between a
teammate and a form submission. Both providers stream SSE, the same wire format AG-UI
uses, so this reuses `lib/sse.py` rather than parsing events twice.

**Disabled is a first-class state, not an error path.** Self-hosted Blob with no API key
is a completely reasonable deployment, and the promise is that a workspace stays up. So
`configured` is checked before anything is offered in the UI, the agent is never seeded
into a workspace that cannot run it, and a call that gets here anyway returns a sentence
a person can act on rather than a traceback.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass

import httpx

from ..config import settings
from .sse import SseDecoder

#: Sent to Anthropic. Their API refuses an unknown version outright, so this is pinned
#: rather than read from configuration — a deployment cannot usefully choose it.
ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "openai": "gpt-4.1",
}


class LlmError(Exception):
    """No model is configured, or the provider refused.

    Carries a sentence meant for a person reading a channel, because that is where it
    ends up: `stream_run` turns it into the run's error and the run log shows it.
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
    reasons, content-block boundaries — and none of it is Blob's business: the caller is
    turning this into AG-UI events and needs the prose.
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
    base = (settings.LLM_BASE_URL or "https://api.anthropic.com").rstrip("/")
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
    base = (settings.LLM_BASE_URL or "https://api.openai.com").rstrip("/")
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


__all__ = ["LlmError", "Turn", "configured", "model_name", "stream_reply"]
