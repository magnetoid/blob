"""Blob against the official AG-UI SDK, used as an oracle rather than a runtime dependency.

ADR 0011 keeps the SDK out of the server on purpose: a strict union over a moving
protocol turns next month's event into a dead agent, so `plugins/agui.py` reads events as
plain mappings and ignores what it does not know. That leaves nothing to say when Blob's
reading of the protocol drifts from the protocol — the ADR said the SDK would be a test
dependency for exactly that, and until now it was not installed at all.

Two directions. What Blob *sends* — the run input, a plain run and a resume — must
validate against the SDK's own model, because an agent built on it refuses anything
else with a 422 that looks like the agent being down. What Blob *reads* must be what the
SDK's own encoder writes: SSE frames in, the same messages, decisions and state out.
"""

from __future__ import annotations

from typing import Any

import pytest
from ag_ui import core
from ag_ui.encoder import EventEncoder

from blob_api.lib import sse
from blob_api.plugins import agui, run_card

ENCODER = EventEncoder()


def wire(*events: core.BaseEvent) -> bytes:
    """Events exactly as an agent built on the SDK puts them on the wire."""
    return "".join(ENCODER.encode(event) for event in events).encode()


def read(raw: bytes) -> tuple[agui.Fold, list[agui.Post]]:
    """The bytes through Blob's decoder and fold, as the job reads a stream."""
    decoder, fold = sse.SseDecoder(), agui.Fold()
    posts: list[agui.Post] = []
    for event in decoder.feed(raw):
        posts.extend(fold.feed(event))
    for event in decoder.close():
        posts.extend(fold.feed(event))
    posts.extend(fold.finish())
    return fold, posts


def run_input(**overrides: Any) -> dict[str, Any]:
    return agui.build_run_input(
        thread_id="t1",
        run_id="r1",
        messages=[
            {"id": "m1", "role": "user", "content": "@Janus when is standup?", "name": "Ana"},
            {"id": "m2", "role": "assistant", "content": "At nine."},
        ],
        channel_name="general",
        trigger_user="Ana",
        **overrides,
    )


class TestWhatBlobSends:
    def test_a_run_validates_against_the_sdk(self) -> None:
        parsed = core.RunAgentInput.model_validate(run_input())
        assert parsed.thread_id == "t1" and parsed.run_id == "r1"
        assert [m.role for m in parsed.messages] == ["user", "assistant"]

    def test_a_resume_validates_against_the_sdk(self) -> None:
        parsed = core.RunAgentInput.model_validate(
            run_input(
                parent_run_id="r0",
                resume=[{"interruptId": "i1", "status": "resolved", "payload": True}],
                state={"step": 2},
                instructions="Answer in English.",
            )
        )
        assert parsed.parent_run_id == "r0"
        assert parsed.resume is not None and parsed.resume[0].interrupt_id == "i1"
        assert parsed.forwarded_props == {"instructions": "Answer in English."}


class TestWhatBlobReads:
    def test_a_message_the_sdk_writes_is_one_post(self) -> None:
        _, posts = read(
            wire(
                core.RunStartedEvent(thread_id="t1", run_id="r1"),
                core.TextMessageStartEvent(message_id="m1", role="assistant"),
                core.TextMessageContentEvent(message_id="m1", delta="Standup "),
                core.TextMessageContentEvent(message_id="m1", delta="is at nine."),
                core.TextMessageEndEvent(message_id="m1"),
                core.RunFinishedEvent(thread_id="t1", run_id="r1"),
            )
        )
        assert [p.body for p in posts] == ["Standup is at nine."]

    def test_the_compact_form_is_read_like_the_triad(self) -> None:
        _, posts = read(
            wire(
                core.TextMessageChunkEvent(message_id="m1", role="assistant", delta="Nine "),
                core.TextMessageChunkEvent(message_id="m1", delta="sharp."),
                core.RunFinishedEvent(thread_id="t1", run_id="r1"),
            )
        )
        assert [p.body for p in posts] == ["Nine sharp."]

    def test_an_interrupt_the_sdk_writes_is_a_decision(self) -> None:
        fold, posts = read(
            wire(
                core.RunFinishedEvent(
                    thread_id="t1",
                    run_id="r1",
                    outcome=core.RunFinishedInterruptOutcome(
                        type="interrupt",
                        interrupts=[
                            core.Interrupt(
                                id="i1",
                                reason="approval",
                                message="Deploy to production?",
                                response_schema={"type": "boolean"},
                            )
                        ],
                    ),
                )
            )
        )
        assert posts == []
        assert fold.interrupt == "Deploy to production?"
        decision = agui.decision_of(fold.interrupts)
        assert [c.value for c in decision.choices] == [True, False]
        assert decision.interrupt_ids == ["i1"]

    def test_state_the_sdk_writes_is_folded(self) -> None:
        fold, _ = read(
            wire(
                core.StateSnapshotEvent(snapshot={"plan": ["build", "deploy"], "step": 1}),
                core.StateDeltaEvent(delta=[{"op": "replace", "path": "/step", "value": 2}]),
            )
        )
        assert fold.state == {"plan": ["build", "deploy"], "step": 2}

    def test_an_error_the_sdk_writes_fails_the_run(self) -> None:
        fold, _ = read(wire(core.RunErrorEvent(message="the model refused", code="refusal")))
        assert fold.error == "the model refused"

    def test_a_file_travels_in_the_sdks_custom_event(self) -> None:
        _, posts = read(
            wire(
                core.CustomEvent(
                    name="blob.file.start", value={"id": "f1", "name": "a.txt", "size": 2}
                ),
                core.CustomEvent(name="blob.file.chunk", value={"id": "f1", "data": "aGk="}),
                core.CustomEvent(name="blob.file.end", value={"id": "f1"}),
            )
        )
        assert [f.name for p in posts for f in p.files] == ["a.txt"]


#: One well-formed instance of every event the SDK defines. A new member of the enum
#: with no entry here fails `test_every_event_the_protocol_defines_is_covered`, which is
#: the point: the next protocol revision should arrive as a failing test, not as an agent
#: that silently stopped answering.
EVERY_EVENT: dict[str, core.BaseEvent] = {
    "TEXT_MESSAGE_START": core.TextMessageStartEvent(message_id="m", role="assistant"),
    "TEXT_MESSAGE_CONTENT": core.TextMessageContentEvent(message_id="m", delta="x"),
    "TEXT_MESSAGE_END": core.TextMessageEndEvent(message_id="m"),
    "TEXT_MESSAGE_CHUNK": core.TextMessageChunkEvent(message_id="m", delta="x"),
    "TOOL_CALL_START": core.ToolCallStartEvent(tool_call_id="c", tool_call_name="search"),
    "TOOL_CALL_ARGS": core.ToolCallArgsEvent(tool_call_id="c", delta="{}"),
    "TOOL_CALL_END": core.ToolCallEndEvent(tool_call_id="c"),
    "TOOL_CALL_CHUNK": core.ToolCallChunkEvent(tool_call_id="c", tool_call_name="search"),
    "TOOL_CALL_RESULT": core.ToolCallResultEvent(message_id="t", tool_call_id="c", content="ok"),
    "STATE_SNAPSHOT": core.StateSnapshotEvent(snapshot={"a": 1}),
    "STATE_DELTA": core.StateDeltaEvent(delta=[{"op": "add", "path": "/b", "value": 2}]),
    "MESSAGES_SNAPSHOT": core.MessagesSnapshotEvent(messages=[]),
    "ACTIVITY_SNAPSHOT": core.ActivitySnapshotEvent(
        message_id="a", activity_type="progress", content={"label": "reading"}
    ),
    "ACTIVITY_DELTA": core.ActivityDeltaEvent(
        message_id="a",
        activity_type="progress",
        patch=[{"op": "replace", "path": "/label", "value": "writing"}],
    ),
    "RAW": core.RawEvent(event={"anything": True}),
    "CUSTOM": core.CustomEvent(name="vendor.thing", value={"x": 1}),
    "RUN_STARTED": core.RunStartedEvent(thread_id="t", run_id="r"),
    "RUN_FINISHED": core.RunFinishedEvent(thread_id="t", run_id="r"),
    "RUN_ERROR": core.RunErrorEvent(message="no"),
    "STEP_STARTED": core.StepStartedEvent(step_name="plan"),
    "STEP_FINISHED": core.StepFinishedEvent(step_name="plan"),
    "REASONING_START": core.ReasoningStartEvent(message_id="r"),
    "REASONING_MESSAGE_START": core.ReasoningMessageStartEvent(message_id="r", role="reasoning"),
    "REASONING_MESSAGE_CONTENT": core.ReasoningMessageContentEvent(message_id="r", delta="hm"),
    "REASONING_MESSAGE_END": core.ReasoningMessageEndEvent(message_id="r"),
    "REASONING_MESSAGE_CHUNK": core.ReasoningMessageChunkEvent(message_id="r", delta="hm"),
    "REASONING_END": core.ReasoningEndEvent(message_id="r"),
    "REASONING_ENCRYPTED_VALUE": core.ReasoningEncryptedValueEvent(
        subtype="message", entity_id="r", encrypted_value="opaque"
    ),
    "SUBAGENT_STARTED": core.SubagentStartedEvent(subagent_run_id="s", name="researcher"),
    "SUBAGENT_FINISHED": core.SubagentFinishedEvent(subagent_run_id="s"),
    "SUBAGENT_ERROR": core.SubagentErrorEvent(subagent_run_id="s", message="no"),
}


def test_every_event_the_protocol_defines_is_covered() -> None:
    assert {e.value for e in core.EventType} == set(EVERY_EVENT)


@pytest.mark.parametrize("kind", sorted(EVERY_EVENT))
def test_no_event_the_protocol_defines_breaks_a_run(kind: str) -> None:
    # Tolerance is the whole of ADR 0011's reading rule: whatever the SDK can write, the
    # fold and the card take without raising, and reasoning never becomes an answer.
    decoder = sse.SseDecoder()
    [event] = list(decoder.feed(wire(EVERY_EVENT[kind])))
    fold, card = agui.Fold(), run_card.CardFold()
    posts = [*fold.feed(event), *fold.finish()]
    card.feed(event)
    card.snapshot()
    if kind.startswith("REASONING"):
        assert posts == []
