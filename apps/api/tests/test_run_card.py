"""The card fold: AG-UI events in, a bounded render-ready dict out.

Wire values are SCREAMING_SNAKE — the single most re-learned fact in this codebase —
so every literal here is also a pin against someone "fixing" them to PascalCase.
"""

from __future__ import annotations

from blob_api.plugins.run_card import (
    MAX_ARG_CHARS,
    MAX_REASONING_CHARS,
    MAX_STEPS,
    MAX_TOOLS,
    CardFold,
)


def test_steps_run_and_finish() -> None:
    card = CardFold()
    assert card.feed({"type": "STEP_STARTED", "stepName": "read the repo"})
    assert card.feed({"type": "STEP_STARTED", "stepName": "write the answer"})
    assert card.feed({"type": "STEP_FINISHED", "stepName": "read the repo"})

    snapshot = card.snapshot()
    assert snapshot["steps"] == [
        {"name": "read the repo", "status": "done"},
        {"name": "write the answer", "status": "running"},
    ]


def test_a_finish_for_an_unannounced_step_still_appears() -> None:
    card = CardFold()
    assert card.feed({"type": "STEP_FINISHED", "stepName": "surprise"})
    assert card.snapshot()["steps"] == [{"name": "surprise", "status": "done"}]


def test_tool_calls_go_through_three_phases() -> None:
    card = CardFold()
    assert card.feed({"type": "TOOL_CALL_START", "toolCallId": "t1", "toolCallName": "search"})
    assert card.feed({"type": "TOOL_CALL_ARGS", "toolCallId": "t1", "delta": '{"q": "docs"}'})
    assert card.feed({"type": "TOOL_CALL_END", "toolCallId": "t1"})
    assert card.feed({"type": "TOOL_CALL_RESULT", "toolCallId": "t1", "content": "3 hits"})

    (tool,) = card.snapshot()["tools"]
    assert tool == {"name": "search", "status": "done", "args": '{"q": "docs"}', "result": "3 hits"}


def test_args_without_an_id_attach_to_the_open_call() -> None:
    # The streaming shape every SDK produces: args deltas ride without repeating the id.
    card = CardFold()
    card.feed({"type": "TOOL_CALL_START", "toolCallName": "fetch"})
    card.feed({"type": "TOOL_CALL_ARGS", "delta": "abc"})
    assert card.snapshot()["tools"][0]["args"] == "abc"


def test_activity_keeps_only_the_latest_line() -> None:
    card = CardFold()
    assert card.feed({"type": "ACTIVITY_DELTA", "message": "reading files"})
    assert card.feed({"type": "ACTIVITY_DELTA", "message": "running tests"})
    assert not card.feed({"type": "ACTIVITY_DELTA", "message": "running tests"})
    assert card.snapshot()["activity"] == "running tests"


def test_reasoning_keeps_a_bounded_tail() -> None:
    card = CardFold()
    for _ in range(100):
        card.feed({"type": "REASONING_CONTENT", "delta": "x" * 100})
    reasoning = card.snapshot()["reasoning"]
    assert reasoning is not None and len(reasoning) == MAX_REASONING_CHARS


def test_the_card_cannot_grow_without_limit() -> None:
    card = CardFold()
    for index in range(MAX_STEPS * 3):
        card.feed({"type": "STEP_STARTED", "stepName": f"step-{index}"})
    for index in range(MAX_TOOLS * 3):
        card.feed({"type": "TOOL_CALL_START", "toolCallId": str(index), "toolCallName": "t"})
    card.feed({"type": "TOOL_CALL_ARGS", "toolCallId": "0", "delta": "y" * (MAX_ARG_CHARS * 5)})

    snapshot = card.snapshot()
    assert len(snapshot["steps"]) == MAX_STEPS
    assert len(snapshot["tools"]) == MAX_TOOLS
    assert len(snapshot["tools"][0]["args"]) <= MAX_ARG_CHARS
    assert snapshot["dropped"] > 0


def test_unknown_events_are_inert() -> None:
    card = CardFold()
    assert not card.feed({"type": "RUN_STARTED"})
    assert not card.feed({"type": "STATE_DELTA", "delta": []})
    assert not card.feed({"type": "SOMETHING_NEW", "x": 1})
    assert not card.feed({"no_type": True})
    assert not card.has_content


def test_text_progress_is_counted_not_kept() -> None:
    card = CardFold()
    card.feed({"type": "TEXT_MESSAGE_CONTENT", "delta": "hello "})
    card.feed({"type": "TEXT_MESSAGE_CONTENT", "delta": "world"})
    snapshot = card.snapshot()
    assert snapshot["textChars"] == 11
