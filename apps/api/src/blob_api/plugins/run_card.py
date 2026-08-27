"""What an in-flight agent run looks like, folded from its AG-UI events.

`agui.Fold` answers "what messages should be posted"; this answers "what is the agent
doing right now" — the plan steps, the tool calls with their arguments and results,
the latest activity line, and a bounded tail of its reasoning. The card is a plain
dict (camelCase keys, wire- and JSONB-ready) that the client renders live and the
`agent_runs` row keeps afterwards, so a reload shows the same card the stream drew.

Pure by construction, like `agui.py`: bytes of events in, a dict out, no I/O — which
is what lets every transport share it and lets the tests feed it a list.

Size-capped by construction, because the stream is somebody else's program: steps and
tools stop accumulating past a bound, text fields are truncated, and the reasoning
buffer keeps only its tail. An agent cannot grow this card without limit.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

#: Wire values are SCREAMING_SNAKE — verified against ag-ui-protocol/ag-ui, and worth
#: restating because the docs' section headers confidently suggest otherwise.

MAX_STEPS = 30
MAX_TOOLS = 30
MAX_ARG_CHARS = 400
MAX_RESULT_CHARS = 600
MAX_ACTIVITY_CHARS = 200
MAX_REASONING_CHARS = 2000
MAX_NAME_CHARS = 80


class CardFold:
    """Folds lifecycle events into the live card. `feed` returns whether it changed."""

    def __init__(self) -> None:
        self._steps: list[dict[str, Any]] = []
        self._tools: list[dict[str, Any]] = []
        self._tool_index: dict[str, dict[str, Any]] = {}
        self._activity: str | None = None
        self._reasoning = ""
        self._text_chars = 0
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
            return self._activity_line(event)

        if kind.startswith(("REASONING", "THINKING")):
            delta = event.get("delta")
            if isinstance(delta, str) and delta:
                self._reasoning = (self._reasoning + delta)[-MAX_REASONING_CHARS:]
                return True
            return False

        if kind == "TEXT_MESSAGE_CONTENT":
            delta = event.get("delta")
            if isinstance(delta, str):
                self._text_chars += len(delta)
                return True
            return False

        # RUN_*, STATE_*, MESSAGES_SNAPSHOT, CUSTOM, RAW — the card has nothing to say.
        return False

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
            content = _text(event.get("content"), MAX_RESULT_CHARS)
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

    def _activity_line(self, event: Mapping[str, Any]) -> bool:
        for key in ("message", "description", "text", "content", "activity"):
            line = _text(event.get(key), MAX_ACTIVITY_CHARS)
            if line:
                if line == self._activity:
                    return False
                self._activity = line
                return True
        return False

    def snapshot(self) -> dict[str, Any]:
        """The card as the wire and the row carry it. Snapshots, not deltas: a client
        that reconnects mid-run renders the next one whole, with no state to replay."""
        return {
            "steps": [dict(step) for step in self._steps],
            "tools": [dict(tool) for tool in self._tools],
            "activity": self._activity,
            "reasoning": self._reasoning or None,
            "textChars": self._text_chars,
            "dropped": self._dropped,
        }

    @property
    def has_content(self) -> bool:
        return bool(self._steps or self._tools or self._activity or self._reasoning)


def _text(value: Any, cap: int) -> str | None:
    if isinstance(value, str) and value:
        return value[:cap]
    return None


__all__ = ["CardFold"]
