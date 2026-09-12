"""DeepSeek: the third provider, and the first one that is OpenAI-shaped but not OpenAI.

The dispatch in `lib/llm.py` has always been "Anthropic, or else the OpenAI shape", so
DeepSeek needs no request builder of its own — it speaks `/v1/chat/completions`. What it
does need is the two things that were previously hardcoded to mean "OpenAI": the host to
send to, and whether the server understands a *strict* JSON schema. Both were written as
`settings.LLM_BASE_URL or "https://api.openai.com"` and `LLM_BASE_URL is None`, which
read "no override means real OpenAI" — true when there were two providers and wrong the
moment there are three.

These tests pin the provider, not the base URL, as the thing that decides.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from blob_api.config import settings
from blob_api.lib import llm

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}
TURNS = [llm.Turn(role="user", content="Answer in JSON.")]


def answers(content: str) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
                ]
            },
        )

    return httpx.MockTransport(handler), seen


def streams(*chunks: str) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    seen: list[httpx.Request] = []
    frames = "".join(
        "data: " + json.dumps({"choices": [{"delta": {"content": chunk}}]}) + "\n\n"
        for chunk in chunks
    )

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=frames + "data: [DONE]\n\n")

    return httpx.MockTransport(handler), seen


@pytest.fixture
def deepseek(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "LLM_PROVIDER", "deepseek")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", None)
    monkeypatch.setattr(settings, "LLM_MODEL", None)
    slot: dict[str, Any] = {"transport": None}
    monkeypatch.setattr(llm, "open_client", lambda: httpx.AsyncClient(transport=slot["transport"]))
    return slot


class TestConfiguration:
    def test_a_key_alone_configures_it(self, deepseek: dict[str, Any]) -> None:
        assert llm.configured() is True

    def test_the_default_model_is_deepseek_chat(self, deepseek: dict[str, Any]) -> None:
        assert llm.model_name() == "deepseek-chat"

    def test_an_explicit_model_still_wins(
        self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_MODEL", "deepseek-reasoner")
        assert llm.model_name() == "deepseek-reasoner"


class TestRouting:
    async def test_complete_reaches_deepseek_with_no_base_url_set(
        self, deepseek: dict[str, Any]
    ) -> None:
        deepseek["transport"], seen = answers('{"answer": "yes"}')
        reply = await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=None
        )
        assert reply == '{"answer": "yes"}'
        (request,) = seen
        assert str(request.url) == "https://api.deepseek.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"

    async def test_streaming_reaches_deepseek_too(self, deepseek: dict[str, Any]) -> None:
        deepseek["transport"], seen = streams("Hel", "lo")
        out = [chunk async for chunk in llm.stream_reply(system="Hi.", turns=TURNS)]
        assert "".join(out) == "Hello"
        assert str(seen[0].url) == "https://api.deepseek.com/v1/chat/completions"

    async def test_an_explicit_base_url_still_overrides(
        self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_BASE_URL", "http://proxy.internal:8080")
        deepseek["transport"], seen = answers('{"answer": "yes"}')
        await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=None
        )
        assert str(seen[0].url) == "http://proxy.internal:8080/v1/chat/completions"

    async def test_openai_is_unmoved_by_any_of_this(
        self, deepseek: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
        deepseek["transport"], seen = answers('{"answer": "yes"}')
        await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=None
        )
        assert str(seen[0].url) == "https://api.openai.com/v1/chat/completions"


class TestStructuredOutput:
    async def test_deepseek_gets_plain_json_mode_not_the_strict_schema(
        self, deepseek: dict[str, Any]
    ) -> None:
        """DeepSeek answers `{"type": "json_object"}` and 400s on a strict `json_schema`.

        The old test for this was "did the operator set LLM_BASE_URL", which DeepSeek
        does not, so without a provider-aware check the summary path would send a hint
        DeepSeek refuses and eat a retry on every single call.
        """
        deepseek["transport"], seen = answers('{"answer": "yes"}')
        await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=SCHEMA
        )
        body = json.loads(seen[0].content)
        assert body["response_format"] == {"type": "json_object"}


class TestTools:
    async def test_tool_calls_use_the_openai_shape_against_deepseek(
        self, deepseek: dict[str, Any]
    ) -> None:
        """DeepSeek's function calling is OpenAI's, so the OpenAI turn builder is reused.

        Pinned because the dispatch reads `== "anthropic"`: if that ever became a
        positive test for `== "openai"`, DeepSeek would silently lose tools.
        """
        frames = [
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "function": {
                                        "name": "read_channel",
                                        "arguments": '{"channel": "launch"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if len(seen) == 1:
                text = "".join("data: " + json.dumps(f) + "\n\n" for f in frames)
                return httpx.Response(200, text=text + "data: [DONE]\n\n")
            done = {"choices": [{"delta": {"content": "Done."}}]}
            return httpx.Response(200, text="data: " + json.dumps(done) + "\n\ndata: [DONE]\n\n")

        deepseek["transport"] = httpx.MockTransport(handler)

        async def call(name: str, arguments: dict[str, Any]) -> str:
            return f"{name} saw 3 messages"

        pieces = [
            piece
            async for piece in llm.stream_reply_with_tools(
                system="Use tools.",
                turns=TURNS,
                tools=[{"name": "read_channel", "input_schema": {"type": "object"}}],
                call=call,
                max_rounds=2,
            )
        ]
        assert any(isinstance(p, llm.ToolCall) and p.name == "read_channel" for p in pieces)
        assert any(isinstance(p, llm.ToolResult) for p in pieces)
        assert "".join(p for p in pieces if isinstance(p, str)) == "Done."
        assert str(seen[0].url) == "https://api.deepseek.com/v1/chat/completions"
        assert json.loads(seen[0].content)["tools"][0]["function"]["name"] == "read_channel"
