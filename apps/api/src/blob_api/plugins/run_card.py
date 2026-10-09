"""What an in-flight agent run looks like, folded from its AG-UI events.

`agui.Fold` answers "what messages should be posted"; this answers "what is the agent
doing right now" — the plan steps, the tool calls with their arguments and results,
the latest activity line, a bounded tail of its reasoning, and the tail of the answer it
is writing. The card is a plain dict (camelCase keys, wire- and JSONB-ready) that the
client renders live and the `agent_runs` row keeps afterwards, so a reload shows the same
card the stream drew.

The answer's tail is a draft, not the answer. ADR 0011 stands: the message is written
once, when it is finished — a row edited forty times is "(edited)" for ever and broadcast
forty times. What the card carries is a preview of it, for the minute or two it takes,
and it is gone from the card the moment the message is posted (`posted`) and from the
card the row keeps (`snapshot(final=True)`).

Pure by construction, like `agui.py`: bytes of events in, a dict out, no I/O — which
is what lets every transport share it and lets the tests feed it a list.

Size-capped by construction, because the stream is somebody else's program: steps and
tools stop accumulating past a bound, text fields are truncated, and the reasoning
buffer keeps only its tail. An agent cannot grow this card without limit.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..lib import jsonpatch
from . import agui

#: Wire values are SCREAMING_SNAKE — verified against ag-ui-protocol/ag-ui, and worth
#: restating because the docs' section headers confidently suggest otherwise.

MAX_STEPS = 30
MAX_TOOLS = 30
MAX_ARG_CHARS = 400
MAX_RESULT_CHARS = 600
MAX_ACTIVITY_CHARS = 200
#: The object an ACTIVITY_DELTA patches holds one line to show; nothing real is near this,
#: and it is what stops a patch that copies the object into itself from doubling it.
ACTIVITY_MAX_BYTES = 16 * 1024
MAX_REASONING_CHARS = 2000
MAX_NAME_CHARS = 80
MAX_SUBAGENTS = 10
#: How much of the answer being written the card carries: its tail, the part a person is
#: reading as it arrives. Two kilobytes, snapshots four times a second at most.
MAX_TEXT_TAIL_CHARS = 2000

#: The keys of an AG-UI 1.0 activity's `content` read for the card's one line, in order.
#: The content's shape belongs to its `activityType`, so the card looks for the plain
#: words a progress object carries rather than knowing every type.
_ACTIVITY_KEYS = ("title", "label", "message", "status", "description", "text")


class CardFold:
    """Folds lifecycle events into the live card. `feed` returns whether it changed.

    Reasoning is kept only when the run is told to show it (`show_reasoning`). The card
    goes to everyone in the channel, and an agent's working-out is where it narrates what
    it read — including from tools and memory of its own that reach past the room. Kept by
    default, it was shown to the room while the integrator guide told authors it was
    ignored; hidden by default, the two agree. Showing it is meant to be a per-agent
    switch (`Listener.shows_reasoning`), and until the console has one, nothing sets it.
    """

    def __init__(self, *, show_reasoning: bool = False) -> None:
        self._show_reasoning = show_reasoning
        self._steps: list[dict[str, Any]] = []
        self._tools: list[dict[str, Any]] = []
        self._tool_index: dict[str, dict[str, Any]] = {}
        self._activity: str | None = None
        #: AG-UI 1.0 activities by `messageId`: the content object a snapshot set and
        #: deltas patch. The line shown is read from the latest one touched.
        self._activities: dict[str, Any] = {}
        self._subagents: list[dict[str, Any]] = []
        self._subagent_index: dict[str, dict[str, Any]] = {}
        self._reasoning = ""
        self._text_chars = 0
        #: The tail of the message the agent is writing, and which message that is.
        self._text_tail = ""
        self._text_message: str | None = None
        #: Messages opened under somebody else's role — quoting the person back. Not the
        #: agent's words, so never its draft either: the rule `agui.Fold` applies.
        self._quoted: set[str] = set()
        self._dropped = 0

    def feed(self, event: Mapping[str, Any]) -> bool:
        kind = event.get("type")
        if not isinstance(kind, str):
            return False

        if kind == "STEP_STARTED":
            return self._step(event, running=True)
        if kind == "STEP_FINISHED":
            return self._step(event, running=False)

        if kind == "TOOL_CALL_START":
            return self._tool_start(event)
        if kind == "TOOL_CALL_ARGS":
            return self._tool_args(event)
        if kind in ("TOOL_CALL_END", "TOOL_CALL_RESULT"):
            return self._tool_end(event, kind)

        if kind in ("ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA"):
            return self._activity_event(event, kind)

        if kind in ("SUBAGENT_STARTED", "SUBAGENT_FINISHED", "SUBAGENT_ERROR"):
            return self._subagent(event, kind)

        if kind.startswith(("REASONING", "THINKING")):
            if not self._show_reasoning:
                return False
            delta = event.get("delta")
            if isinstance(delta, str) and delta:
                self._reasoning = (self._reasoning + delta)[-MAX_REASONING_CHARS:]
                return True
            return False

        if kind == "TEXT_MESSAGE_START":
            return self._text_start(event)
        if kind in ("TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"):
            return self._text_delta(event, kind)
        if kind == "TEXT_MESSAGE_END":
            self._quoted.discard(agui._message_id(event))
            return False

        # RUN_*, STATE_*, MESSAGES_SNAPSHOT, CUSTOM, RAW — the card has nothing to say.
        return False

    def _text_start(self, event: Mapping[str, Any]) -> bool:
        message_id = agui._message_id(event)
        if agui._quoting(event):
            self._quoted.add(message_id)
            return False
        self._quoted.discard(message_id)
        return self._draft_of(message_id)

    def _text_delta(self, event: Mapping[str, Any], kind: str) -> bool:
        message_id = agui._message_id(event)
        if kind == "TEXT_MESSAGE_CHUNK" and "role" in event:
            # The compact form carries its role on each chunk, as `agui.Fold` reads it.
            if agui._quoting(event):
                self._quoted.add(message_id)
            else:
                self._quoted.discard(message_id)
        if message_id in self._quoted:
            return False
        delta = event.get("delta")
        if not isinstance(delta, str) or not delta:
            return False
        self._text_chars += len(delta)
        self._draft_of(message_id)
        self._text_tail = (self._text_tail + delta)[-MAX_TEXT_TAIL_CHARS:]
        return True

    def _draft_of(self, message_id: str) -> bool:
        """Make `message_id` the one the draft shows. A new message starts it empty."""
        if self._text_message == message_id:
            return False
        self._text_message = message_id
        had = bool(self._text_tail)
        self._text_tail = ""
        return had

    def posted(self) -> bool:
        """What the agent wrote is in the channel now, so the draft of it goes. Returns
        whether the card changed, for the caller to send it once more."""
        if not self._text_tail and self._text_message is None:
            return False
        had = bool(self._text_tail)
        self._text_tail = ""
        self._text_message = None
        return had

    def _step(self, event: Mapping[str, Any], *, running: bool) -> bool:
        name = _text(event.get("stepName"), MAX_NAME_CHARS) or "step"
        for step in self._steps:
            if step["name"] == name:
                if step["status"] == "done":
                    return False
                if not running:
                    step["status"] = "done"
                    return True
                return False
        if running:
            if len(self._steps) >= MAX_STEPS:
                self._dropped += 1
                return False
            self._steps.append({"name": name, "status": "running"})
            return True
        # A finish for a step never started still deserves a row: the agent said it
        # happened, and a card that silently ate it would under-report the work.
        if len(self._steps) < MAX_STEPS:
            self._steps.append({"name": name, "status": "done"})
            return True
        self._dropped += 1
        return False

    def _tool_start(self, event: Mapping[str, Any]) -> bool:
        call_id = _text(event.get("toolCallId"), 64)
        name = _text(event.get("toolCallName"), MAX_NAME_CHARS) or "tool"
        if len(self._tools) >= MAX_TOOLS:
            self._dropped += 1
            return False
        tool = {"name": name, "status": "running", "args": "", "result": None}
        self._tools.append(tool)
        if call_id:
            self._tool_index[call_id] = tool
        return True

    def _tool_args(self, event: Mapping[str, Any]) -> bool:
        tool = self._find_tool(event)
        if tool is None:
            return False
        delta = event.get("delta")
        if not isinstance(delta, str) or not delta:
            return False
        if len(tool["args"]) >= MAX_ARG_CHARS:
            return False
        tool["args"] = (tool["args"] + delta)[:MAX_ARG_CHARS]
        return True

    def _tool_end(self, event: Mapping[str, Any], kind: str) -> bool:
        tool = self._find_tool(event)
        if tool is None:
            return False
        changed = tool["status"] != "done"
        tool["status"] = "done"
        if kind == "TOOL_CALL_RESULT":
            content = _text(_parts_text(event.get("content")), MAX_RESULT_CHARS)
            if content:
                tool["result"] = content
                changed = True
        return changed

    def _find_tool(self, event: Mapping[str, Any]) -> dict[str, Any] | None:
        call_id = _text(event.get("toolCallId"), 64)
        if call_id and call_id in self._tool_index:
            return self._tool_index[call_id]
        # Args/results without an id belong to the newest open call — the streaming
        # shape every SDK produces.
        for tool in reversed(self._tools):
            if tool["status"] == "running":
                return tool
        return None

    def _activity_event(self, event: Mapping[str, Any], kind: str) -> bool:
        """An activity, in either shape it has had.

        AG-UI 1.0: a snapshot sets a `content` object for a `messageId` and a delta
        patches it (JSON Patch), and what the object holds belongs to its
        `activityType`. Before 1.0 producers put a string at the top level, and some
        still do; that shape is read too.
        """
        message_id = event.get("messageId")
        if isinstance(message_id, str) and message_id:
            if kind == "ACTIVITY_SNAPSHOT" and isinstance(event.get("content"), Mapping):
                if len(json.dumps(event["content"], default=str)) > ACTIVITY_MAX_BYTES:
                    return False  # held to the budget its deltas are, or they all fail
                self._activities[message_id] = dict(event["content"])
                return self._set_activity(_activity_text(self._activities[message_id], event))
            patch = event.get("patch")
            if kind == "ACTIVITY_DELTA" and isinstance(patch, list):
                current = self._activities.get(message_id, {})
                try:
                    patched = jsonpatch.apply(current, patch, max_bytes=ACTIVITY_MAX_BYTES)
                except jsonpatch.PatchError:
                    return False  # Keep the last good line rather than half a patch.
                if isinstance(patched, Mapping):
                    self._activities[message_id] = dict(patched)
                    return self._set_activity(_activity_text(self._activities[message_id], event))
                return False
        for key in ("message", "description", "text", "content", "activity"):
            line = _text(event.get(key), MAX_ACTIVITY_CHARS)
            if line:
                return self._set_activity(line)
        return False

    def _set_activity(self, line: str | None) -> bool:
        if not line or line == self._activity:
            return False
        self._activity = line
        return True

    def _subagent(self, event: Mapping[str, Any], kind: str) -> bool:
        """Delegated work, drawn like a step: AG-UI 1.0's subagent lifecycle."""
        run_id = _text(event.get("subagentRunId"), 64)
        if run_id is None:
            return False
        if kind == "SUBAGENT_STARTED":
            if run_id in self._subagent_index:
                return False  # A repeated start is noise, not a second subagent.
            if len(self._subagents) >= MAX_SUBAGENTS:
                self._dropped += 1
                return False
            started: dict[str, Any] = {
                "name": _text(event.get("name"), MAX_NAME_CHARS) or "subagent",
                "status": "running",
            }
            self._subagents.append(started)
            self._subagent_index[run_id] = started
            return True
        known = self._subagent_index.get(run_id)
        if known is None:
            return False
        status = "failed" if kind == "SUBAGENT_ERROR" else "done"
        if known["status"] == status:
            return False
        known["status"] = status
        return True

    def snapshot(self, *, final: bool = False) -> dict[str, Any]:
        """The card as the wire and the row carry it. Snapshots, not deltas: a client
        that reconnects mid-run renders the next one whole, with no state to replay.

        `final` is the card the row keeps once the run is over, which has no draft: what
        was finished is posted, and what was not was never the agent's answer.
        """
        return {
            "steps": [dict(step) for step in self._steps],
            "tools": [dict(tool) for tool in self._tools],
            "activity": self._activity,
            "subagents": [dict(entry) for entry in self._subagents],
            "reasoning": self._reasoning or None,
            "textChars": self._text_chars,
            "textTail": None if final else self._text_tail or None,
            "dropped": self._dropped,
        }

    @property
    def has_content(self) -> bool:
        return bool(
            self._steps or self._tools or self._activity or self._subagents or self._reasoning
        )


def _activity_text(content: Mapping[str, Any], event: Mapping[str, Any]) -> str | None:
    for key in _ACTIVITY_KEYS:
        line = _text(content.get(key), MAX_ACTIVITY_CHARS)
        if line:
            return line
    return _text(event.get("activityType"), MAX_ACTIVITY_CHARS)


def _parts_text(value: Any) -> str | None:
    """A tool result as text: a string, or the text parts of AG-UI 1.0's part list."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        pieces = [
            part["text"]
            for part in value
            if isinstance(part, Mapping)
            and part.get("type") == "text"
            and isinstance(part.get("text"), str)
        ]
        return "\n".join(pieces) or None
    return None


def _text(value: Any, cap: int) -> str | None:
    if isinstance(value, str) and value:
        return value[:cap]
    return None


__all__ = ["CardFold"]
