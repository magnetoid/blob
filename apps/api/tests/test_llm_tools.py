"""`llm.stream_reply_with_tools`: the loop that lets an agent act.

The model asks for a tool; Blob runs it and hands the result back; the model answers.
These pin the shape of that exchange against a scripted provider — what is yielded and
in what order, what the second request has to carry, and the two ways it must stop: a
round limit, and a provider error mid-loop. A tool result is data handed back in the
provider's tool-result shape, never text spliced into a prompt; that is the whole
injection boundary and the second request's body is where it is asserted.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from blob_api.config import settings
from blob_api.lib import llm


def sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"data: {json.dumps(event)}\n\n".encode() for event in events)


def streamed(*events: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=sse(*events))


READ_CHANNEL = {
    "name": "read_channel",
    "description": "Read the recent messages in a channel.",
    "input_schema": {
        "type": "object",
        "properties": {"channel": {"type": "string"}},
        "required": ["channel"],
    },
}

ASK = [llm.Turn(role="user", content="what did I miss in #ops")]


def openai_tool_then_text(
    tool_name: str, arguments: dict[str, Any], answer: str
) -> tuple[Callable[[httpx.Request], httpx.Response], list[dict[str, Any]]]:
    """A provider that asks for one tool on the first request and answers on the second.

    The arguments arrive in two fragments, the way OpenAI actually streams them, so the
    accumulation by `index` is exercised rather than assumed."""
    seen: list[dict[str, Any]] = []
    args = json.dumps(arguments)

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if len(seen) == 1:
            return streamed(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {"name": tool_name, "arguments": args[:6]},
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [{"index": 0, "function": {"arguments": args[6:]}}]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
            )
        return streamed(
            {"choices": [{"delta": {"content": answer[:6]}, "finish_reason": None}]},
            {"choices": [{"delta": {"content": answer[6:]}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        )

    return handler, seen


@pytest.fixture
def openai(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", None)
    slot: dict[str, Any] = {"handler": None}
    monkeypatch.setattr(
        llm,
        "open_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(slot["handler"])),
    )
    return slot


async def collect(**kwargs: Any) -> list[str | llm.ToolCall]:
    return [item async for item in llm.stream_reply_with_tools(**kwargs)]


async def test_a_tool_call_is_run_and_its_result_handed_back(openai: dict[str, Any]) -> None:
    openai["handler"], seen = openai_tool_then_text(
        "read_channel", {"channel": "#ops"}, "Deploy finished at 09:10."
    )
    ran: list[tuple[str, dict[str, Any]]] = []

    async def call(name: str, arguments: dict[str, Any]) -> str:
        ran.append((name, arguments))
        return "09:10 Ana: deploy finished"

    out = await collect(system="You are Blob.", turns=ASK, tools=[READ_CHANNEL], call=call)

    assert ran == [("read_channel", {"channel": "#ops"})]
    assert isinstance(out[0], llm.ToolCall)
    assert (out[0].name, out[0].arguments) == ("read_channel", {"channel": "#ops"})
    assert "".join(piece for piece in out if isinstance(piece, str)) == "Deploy finished at 09:10."

    # The result went back as a tool message, in the provider's shape — never as prose.
    messages = seen[1]["messages"]
    assert messages[-1] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "09:10 Ana: deploy finished",
    }
    assert messages[-2]["role"] == "assistant"
    assert messages[-2]["tool_calls"][0]["id"] == "call_1"
    assert messages[-2]["tool_calls"][0]["function"] == {
        "name": "read_channel",
        "arguments": json.dumps({"channel": "#ops"}),
    }


async def test_tools_are_declared_in_the_providers_shape(openai: dict[str, Any]) -> None:
    openai["handler"], seen = openai_tool_then_text("read_channel", {"channel": "#ops"}, "ok")

    async def call(name: str, arguments: dict[str, Any]) -> str:
        return ""

    await collect(system="s", turns=ASK, tools=[READ_CHANNEL], call=call)

    assert seen[0]["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "read_channel",
                "description": "Read the recent messages in a channel.",
                "parameters": READ_CHANNEL["input_schema"],
            },
        }
    ]


async def test_a_model_that_never_stops_calling_hits_the_round_limit(
    openai: dict[str, Any],
) -> None:
    def always_a_tool(request: httpx.Request) -> httpx.Response:
        return streamed(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_n",
                                    "type": "function",
                                    "function": {"name": "read_channel", "arguments": "{}"},
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ]
            },
            {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
        )

    openai["handler"] = always_a_tool
    rounds = 0

    async def call(name: str, arguments: dict[str, Any]) -> str:
        nonlocal rounds
        rounds += 1
        return "again"

    with pytest.raises(llm.LlmError, match="round"):
        await collect(system="s", turns=ASK, tools=[READ_CHANNEL], call=call, max_rounds=3)
    assert rounds == 3


async def test_a_provider_error_mid_loop_carries_its_message(openai: dict[str, Any]) -> None:
    seen: list[int] = []

    def tool_then_error(request: httpx.Request) -> httpx.Response:
        seen.append(1)
        if len(seen) == 1:
            return streamed(
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {"name": "read_channel", "arguments": "{}"},
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ]
                },
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
            )
        return streamed({"error": {"message": "context window exceeded"}})

    openai["handler"] = tool_then_error

    async def call(name: str, arguments: dict[str, Any]) -> str:
        return "x"

    with pytest.raises(llm.LlmError, match="context window exceeded"):
        await collect(system="s", turns=ASK, tools=[READ_CHANNEL], call=call)


async def test_no_tools_means_the_plain_reply(openai: dict[str, Any]) -> None:
    """With an empty tool list the loop is `stream_reply`: no tools key, text only."""

    def text_only(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "tools" not in body
        return streamed({"choices": [{"delta": {"content": "hi"}, "finish_reason": "stop"}]})

    openai["handler"] = text_only

    async def call(name: str, arguments: dict[str, Any]) -> str:
        raise AssertionError("no tool should run")

    assert await collect(system="s", turns=ASK, tools=[], call=call) == ["hi"]


async def test_a_result_is_yielded_the_moment_its_tool_returns(openai: dict[str, Any]) -> None:
    """A caller drawing a run card needs the answer, not only the question.

    The call and its result are two yielded values rather than one, so a card can show
    the tool line the moment the model commits to a call and fill the answer in when it
    arrives. Batching them would mean a person watching a slow tool sees nothing at all
    until the model has finished thinking about what the tool said.
    """
    openai["handler"], _ = openai_tool_then_text("read_channel", {"channel": "#ops"}, "Done.")

    async def call(name: str, arguments: dict[str, Any]) -> str:
        return "09:10 Ana: deploy finished"

    out = await collect(system="You are Blob.", turns=ASK, tools=[READ_CHANNEL], call=call)

    asked = next(item for item in out if isinstance(item, llm.ToolCall))
    answered = next(item for item in out if isinstance(item, llm.ToolResult))
    assert out.index(asked) < out.index(answered)
    assert (answered.id, answered.name) == (asked.id, asked.name)
    assert answered.content == "09:10 Ana: deploy finished"

    # And it arrives before the text the model writes about it.
    first_text = next(i for i, item in enumerate(out) if isinstance(item, str) and item.strip())
    assert out.index(answered) < first_text
