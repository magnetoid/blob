"""`llm.stream_reply` on Anthropic's wire shape.

Catch-up is the one feature that streams and Anthropic is the first provider in the
table, and the only tests of this parser went with the built-in agent's. What is pinned:
the prose arrives as deltas and nothing else does, and an `error` event after a 200 is a
refusal a person can read rather than the model simply stopping.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from blob_api.config import settings
from blob_api.lib import llm

TURNS = [llm.Turn(role="user", content="what did I miss?")]


def sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"data: {json.dumps(event)}\n\n".encode() for event in events)


def streaming(*events: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse(*events))


@pytest.fixture
def anthropic(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """The provider turned on, and `llm.open_client` — the seam the module owns — pointed
    at whatever transport the test puts in the slot."""
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", None)
    slot: dict[str, Any] = {"transport": None}

    def open_client() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=slot["transport"])

    monkeypatch.setattr(llm, "open_client", open_client)
    return slot


class TestStreaming:
    async def test_text_deltas_are_yielded_and_nothing_else(
        self, anthropic: dict[str, Any]
    ) -> None:
        seen: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(json.loads(request.content))
            return streaming(
                {"type": "message_start", "message": {"usage": {"input_tokens": 5}}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": "On "},
                },
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": "it."},
                },
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn"},
                    "usage": {"output_tokens": 2},
                },
                {"type": "message_stop"},
            )

        anthropic["transport"] = httpx.MockTransport(handler)

        out = [delta async for delta in llm.stream_reply(system="s", turns=TURNS)]

        assert out == ["On ", "it."]
        assert seen[0]["stream"] is True
        assert seen[0]["system"] == "s"

    async def test_an_error_event_after_a_200_is_a_refusal_not_silence(
        self, anthropic: dict[str, Any]
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return streaming(
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": "partial"},
                },
                {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}},
            )

        anthropic["transport"] = httpx.MockTransport(handler)

        out: list[str] = []
        with pytest.raises(llm.LlmError) as caught:
            async for delta in llm.stream_reply(system="s", turns=TURNS):
                out.append(delta)

        # What arrived before the failure was real; what follows is a sentence, not silence.
        assert out == ["partial"]
        assert "Overloaded" in str(caught.value)
