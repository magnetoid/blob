"""The card fold: AG-UI events in, a bounded render-ready dict out.

Wire values are SCREAMING_SNAKE — the single most re-learned fact in this codebase —
so every literal here is also a pin against someone "fixing" them to PascalCase.
"""

from __future__ import annotations

from blob_api.plugins.run_card import (
    MAX_ARG_CHARS,
    MAX_REASONING_CHARS,
    MAX_STEPS,
    MAX_TEXT_TAIL_CHARS,
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


def test_reasoning_keeps_a_bounded_tail_when_the_agent_shows_it() -> None:
    card = CardFold(show_reasoning=True)
    for _ in range(100):
        card.feed({"type": "REASONING_CONTENT", "delta": "x" * 100})
    reasoning = card.snapshot()["reasoning"]
    assert reasoning is not None and len(reasoning) == MAX_REASONING_CHARS


def test_reasoning_is_not_kept_by_default() -> None:
    # The card goes to the whole channel, and the integrator guide tells authors their
    # agent's working-out is not shown. Both THINKING_* (0.x) and REASONING_* (1.0).
    card = CardFold()
    assert not card.feed({"type": "REASONING_MESSAGE_CONTENT", "delta": "the key is 42"})
    assert not card.feed({"type": "THINKING_TEXT_MESSAGE_CONTENT", "delta": "the key is 42"})
    assert card.snapshot()["reasoning"] is None


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


def test_the_answer_being_written_is_a_bounded_draft_on_the_card() -> None:
    card = CardFold()
    # Nothing to show yet, so nothing to send.
    assert not card.feed({"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"})
    assert card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "hello "})
    assert card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "world"})
    snapshot = card.snapshot()
    assert snapshot["textChars"] == 11
    assert snapshot["textTail"] == "hello world"

    card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "x" * 5000})
    assert len(card.snapshot()["textTail"]) == MAX_TEXT_TAIL_CHARS


def test_a_new_message_starts_the_draft_again() -> None:
    card = CardFold()
    card.feed({"type": "TEXT_MESSAGE_CHUNK", "messageId": "m1", "delta": "first"})
    card.feed({"type": "TEXT_MESSAGE_END", "messageId": "m1"})
    assert card.snapshot()["textTail"] == "first"
    assert card.feed({"type": "TEXT_MESSAGE_START", "messageId": "m2"})
    card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m2", "delta": "second"})
    assert card.snapshot()["textTail"] == "second"


def test_a_quote_of_the_person_is_never_the_agents_draft() -> None:
    # The rule `agui.Fold` applies to what is posted, applied to what is previewed.
    card = CardFold()
    assert not card.feed({"type": "TEXT_MESSAGE_START", "messageId": "q", "role": "user"})
    assert not card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "q", "delta": "you said"})
    assert not card.feed(
        {"type": "TEXT_MESSAGE_CHUNK", "messageId": "c", "role": "user", "delta": "x"}
    )
    assert card.snapshot()["textTail"] is None
    assert card.snapshot()["textChars"] == 0


def test_the_draft_goes_once_it_is_posted_and_is_never_kept_on_the_row() -> None:
    card = CardFold()
    card.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "done"})
    assert card.snapshot(final=True)["textTail"] is None
    assert card.posted()
    assert card.snapshot()["textTail"] is None
    assert not card.posted()


def test_an_activity_in_the_1_0_shape_is_read_from_its_content() -> None:
    # 1.0 carries an activity as a content object patched by JSON Patch; the card read
    # top-level strings, so every conforming agent's progress rendered nothing.
    card = CardFold()
    assert card.feed(
        {
            "type": "ACTIVITY_SNAPSHOT",
            "messageId": "a1",
            "activityType": "progress",
            "content": {"label": "reading the thread", "done": 1},
        }
    )
    assert card.snapshot()["activity"] == "reading the thread"
    assert card.feed(
        {
            "type": "ACTIVITY_DELTA",
            "messageId": "a1",
            "activityType": "progress",
            "patch": [{"op": "replace", "path": "/label", "value": "writing the answer"}],
        }
    )
    assert card.snapshot()["activity"] == "writing the answer"


def test_an_activity_with_no_words_falls_back_to_its_type() -> None:
    card = CardFold()
    card.feed(
        {"type": "ACTIVITY_SNAPSHOT", "messageId": "a", "activityType": "search", "content": {}}
    )
    assert card.snapshot()["activity"] == "search"


def test_a_patch_that_does_not_apply_keeps_the_last_good_line() -> None:
    card = CardFold()
    card.feed(
        {
            "type": "ACTIVITY_SNAPSHOT",
            "messageId": "a",
            "activityType": "p",
            "content": {"title": "one"},
        }
    )
    assert not card.feed(
        {
            "type": "ACTIVITY_DELTA",
            "messageId": "a",
            "activityType": "p",
            "patch": [{"op": "replace", "path": "/missing/deep", "value": "x"}],
        }
    )
    assert card.snapshot()["activity"] == "one"


def test_subagents_are_drawn_like_steps() -> None:
    card = CardFold()
    assert card.feed({"type": "SUBAGENT_STARTED", "subagentRunId": "s1", "name": "researcher"})
    assert card.feed({"type": "SUBAGENT_STARTED", "subagentRunId": "s2", "name": "writer"})
    assert not card.feed({"type": "SUBAGENT_STARTED", "subagentRunId": "s1", "name": "again"})
    assert card.feed({"type": "SUBAGENT_FINISHED", "subagentRunId": "s1"})
    assert card.feed({"type": "SUBAGENT_ERROR", "subagentRunId": "s2", "message": "no"})
    assert card.snapshot()["subagents"] == [
        {"name": "researcher", "status": "done"},
        {"name": "writer", "status": "failed"},
    ]
    assert card.has_content


def test_a_tool_result_given_as_parts_shows_its_text() -> None:
    card = CardFold()
    card.feed({"type": "TOOL_CALL_START", "toolCallId": "c", "toolCallName": "search"})
    card.feed(
        {
            "type": "TOOL_CALL_RESULT",
            "toolCallId": "c",
            "messageId": "t",
            "content": [{"type": "text", "text": "3 results"}, {"type": "image", "source": {}}],
        }
    )
    assert card.snapshot()["tools"][0]["result"] == "3 results"
