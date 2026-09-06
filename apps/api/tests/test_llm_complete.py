"""`llm.complete`: one whole reply, shaped, with the provider's stop reason read."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from blob_api.config import settings
from blob_api.lib import llm


def openai_answers(
    content: str, *, finish_reason: str = "stop", refuse_hint_once: bool = False
) -> tuple[httpx.MockTransport, list[dict[str, Any]]]:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if refuse_hint_once and len(seen) == 1 and "response_format" in body:
            return httpx.Response(
                400, json={"error": {"message": "response_format is not supported here"}}
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": finish_reason,
                    }
                ],
                "usage": {"prompt_tokens": 5, "completion_tokens": 5},
            },
        )

    return httpx.MockTransport(handler), seen


@pytest.fixture
def openai(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", None)
    slot: dict[str, Any] = {"transport": None}
    monkeypatch.setattr(llm, "open_client", lambda: httpx.AsyncClient(transport=slot["transport"]))
    return slot


SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}
TURNS = [llm.Turn(role="user", content="Answer in JSON.")]


class TestExtractJson:
    def test_fences_and_preamble_are_tolerated(self) -> None:
        assert llm.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
        assert llm.extract_json('Here you go: {"a": [1, 2]} hope it helps') == {"a": [1, 2]}

    def test_no_object_is_a_typed_failure(self) -> None:
        with pytest.raises(llm.LlmError):
            llm.extract_json("I would rather not.")
        with pytest.raises(llm.LlmError):
            llm.extract_json("[1, 2, 3]")
        with pytest.raises(llm.LlmError):
            llm.extract_json("{not json}")


class TestOpenAi:
    async def test_real_openai_gets_the_strict_schema(self, openai: dict[str, Any]) -> None:
        openai["transport"], seen = openai_answers('{"answer": "yes"}')
        reply = await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=SCHEMA
        )
        assert reply == '{"answer": "yes"}'
        (request,) = seen
        assert request["response_format"]["type"] == "json_schema"
        assert request["response_format"]["json_schema"]["strict"] is True
        assert "stream" not in request

    async def test_a_compatible_server_gets_plain_json_mode(
        self, openai: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_BASE_URL", "http://ollama.local:11434")
        openai["transport"], seen = openai_answers('{"answer": "yes"}')
        await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=SCHEMA
        )
        assert seen[0]["response_format"] == {"type": "json_object"}

    async def test_a_server_that_refuses_the_hint_is_asked_once_more_without_it(
        self, openai: dict[str, Any]
    ) -> None:
        openai["transport"], seen = openai_answers('{"answer": "yes"}', refuse_hint_once=True)
        reply = await llm.complete(
            system="Reply in JSON.", turns=TURNS, max_tokens=64, timeout_sec=5, json_schema=SCHEMA
        )
        assert reply == '{"answer": "yes"}'
        assert "response_format" in seen[0]
        assert "response_format" not in seen[1]

    async def test_running_out_of_room_is_an_error_not_a_fragment(
        self, openai: dict[str, Any]
    ) -> None:
        openai["transport"], _ = openai_answers('{"answer": "ye', finish_reason="length")
        with pytest.raises(llm.LlmError, match="ran out of room"):
            await llm.complete(system="s", turns=TURNS, max_tokens=8, timeout_sec=5)

    async def test_reasoning_models_get_max_completion_tokens_on_the_second_try(
        self, openai: dict[str, Any]
    ) -> None:
        seen: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen.append(body)
            if "max_tokens" in body:
                return httpx.Response(
                    400,
                    json={
                        "error": {
                            "message": "Unsupported parameter: 'max_tokens' is not supported "
                            "with this model. Use 'max_completion_tokens' instead."
                        }
                    },
                )
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]},
            )

        openai["transport"] = httpx.MockTransport(handler)
        assert await llm.complete(system="s", turns=TURNS, max_tokens=64, timeout_sec=5) == "ok"
        assert "max_tokens" in seen[0] and "max_completion_tokens" not in seen[0]
        assert seen[1]["max_completion_tokens"] == 64 and "max_tokens" not in seen[1]

    async def test_a_strict_schema_refusal_is_declined_not_misshapen(
        self, openai: dict[str, Any]
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {"content": None, "refusal": "I can't help with that."},
                            "finish_reason": "stop",
                        }
                    ]
                },
            )

        openai["transport"] = httpx.MockTransport(handler)
        with pytest.raises(llm.LlmError, match="declined"):
            await llm.complete(system="s", turns=TURNS, max_tokens=64, timeout_sec=5)

    async def test_nothing_configured_is_an_error_before_any_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "disabled")
        with pytest.raises(llm.LlmError, match="no model is configured"):
            await llm.complete(system="s", turns=TURNS, max_tokens=8, timeout_sec=5)

    async def test_streaming_is_untouched(self, openai: dict[str, Any]) -> None:
        # The fixture's transport answers whole; stream_reply must still ask for a stream.
        seen: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(json.loads(request.content))
            frame = b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
            return httpx.Response(200, content=frame)

        openai["transport"] = httpx.MockTransport(handler)
        out = [d async for d in llm.stream_reply(system="s", turns=TURNS)]
        assert out == ["hi"]
        assert seen[0]["stream"] is True
