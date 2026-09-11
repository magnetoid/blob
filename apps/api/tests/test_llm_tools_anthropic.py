"""The tool loop against Anthropic's wire shape.

Same contract as the OpenAI file, different bytes. Anthropic streams a tool call as a
`content_block_start` of type `tool_use` carrying the id and name, then the arguments as
`input_json_delta` fragments to be accumulated, then `content_block_stop`, and signals
the turn's end with `message_delta.stop_reason == "tool_use"`. Re-entry sends the
assistant's `tool_use` blocks back verbatim and the result as a `tool_result` block in a
user turn — which is why the loop keeps its own message list rather than a list of
`Turn`s: a turn is text, and these are blocks.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from blob_api.config import settings
from blob_api.lib import llm


def sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"data: {json.dumps(event)}\n\n".encode() for event in events)


def streamed(*events: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, content=sse(*events))


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


def tool_use_events(call_id: str, name: str, arguments: dict[str, Any]) -> list[dict[str, Any]]:
    args = json.dumps(arguments)
    return [
        {"type": "message_start", "message": {"id": "msg_1", "role": "assistant"}},
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "tool_use", "id": call_id, "name": name, "input": {}},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": args[:6]},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": args[6:]},
        },
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}},
        {"type": "message_stop"},
    ]


def text_events(*pieces: str) -> list[dict[str, Any]]:
    return [
        {"type": "message_start", "message": {"id": "msg_2", "role": "assistant"}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        *(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": piece},
            }
            for piece in pieces
        ),
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
        {"type": "message_stop"},
    ]


@pytest.fixture
def anthropic(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
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


async def test_a_tool_call_is_run_and_its_result_handed_back(anthropic: dict[str, Any]) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        if len(seen) == 1:
            return streamed(*tool_use_events("toolu_1", "read_channel", {"channel": "#ops"}))
        return streamed(*text_events("Deploy fin", "ished at 09:10."))

    anthropic["handler"] = handler
    ran: list[tuple[str, dict[str, Any]]] = []

    async def call(name: str, arguments: dict[str, Any]) -> str:
        ran.append((name, arguments))
        return "09:10 Ana: deploy finished"

    out = await collect(system="You are Blob.", turns=ASK, tools=[READ_CHANNEL], call=call)

    assert ran == [("read_channel", {"channel": "#ops"})]
    assert isinstance(out[0], llm.ToolCall)
    first = out[0]
    assert (first.id, first.name, first.arguments) == (
        "toolu_1",
        "read_channel",
        {"channel": "#ops"},
    )
    assert "".join(piece for piece in out if isinstance(piece, str)) == "Deploy finished at 09:10."

    # Declared in Anthropic's shape, and the result went back as a block, not as prose.
    assert seen[0]["tools"] == [READ_CHANNEL]
    messages = seen[1]["messages"]
    assert messages[-2] == {
        "role": "assistant",
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "read_channel",
                "input": {"channel": "#ops"},
            }
        ],
    }
    assert messages[-1] == {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "content": "09:10 Ana: deploy finished",
            }
        ],
    }


async def test_an_error_event_mid_loop_carries_its_message(anthropic: dict[str, Any]) -> None:
    seen: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(1)
        if len(seen) == 1:
            return streamed(*tool_use_events("toolu_1", "read_channel", {}))
        return streamed(
            {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
        )

    anthropic["handler"] = handler

    async def call(name: str, arguments: dict[str, Any]) -> str:
        return "x"

    with pytest.raises(llm.LlmError, match="Overloaded"):
        await collect(system="s", turns=ASK, tools=[READ_CHANNEL], call=call)


async def test_a_model_that_never_stops_calling_hits_the_round_limit(
    anthropic: dict[str, Any],
) -> None:
    anthropic["handler"] = lambda request: streamed(*tool_use_events("toolu_n", "read_channel", {}))
    rounds = 0

    async def call(name: str, arguments: dict[str, Any]) -> str:
        nonlocal rounds
        rounds += 1
        return "again"

    with pytest.raises(llm.LlmError, match="round"):
        await collect(system="s", turns=ASK, tools=[READ_CHANNEL], call=call, max_rounds=2)
    assert rounds == 2
