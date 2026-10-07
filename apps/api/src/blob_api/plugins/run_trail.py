"""What a run streamed, kept for the operator who has to explain it.

The card says what a run did, for the room; the error says how it ended. Neither says what
the agent actually sent, and that is what an operator needs when the two do not explain a
run — a stream that stopped mid-message, a tool call with arguments the agent never
closed, a terminal event that never came. This keeps the last `MAX_EVENTS` raw AG-UI
events of a run, written to `agent_runs.events` when the run ends and emptied after
`KEEP_DAYS` (migration 0052), and the admin console shows them under the run, where the
viewer can see the room (`services/agent_runs.events_of`).

Cut down, never copied whole:

- a long string keeps its start and says how much was left out;
- a file's pieces keep their size, never their bytes;
- reasoning keeps its type and ids and loses its words unless the agent's row shows
  reasoning — the rule the card follows (`run_card.CardFold`), because the log is not a
  way round it;
- an event still too big after that is kept as its type and its keys.

Pure: events in, a JSON-ready value out.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from collections.abc import Mapping
from typing import Any

#: How many events one run keeps — the newest, since the end is where a run goes wrong.
MAX_EVENTS = 200
#: How long a string inside an event may stay, in characters.
MAX_STRING_CHARS = 300
#: How big one event may be once cut, serialised.
MAX_EVENT_CHARS = 2_000
#: How deep into an event's values the cut goes; anything deeper is summarised.
MAX_DEPTH = 6
#: How long a run's events are kept. The run itself is kept for its thirty days.
KEEP_DAYS = 7

log = logging.getLogger("blob.plugins.run_trail")

_REASONING = ("REASONING", "THINKING")
_REASONING_TEXT = ("delta", "content", "text", "title", "encryptedValue")


def _cut(value: Any, depth: int = 0) -> Any:
    if isinstance(value, str):
        if len(value) <= MAX_STRING_CHARS:
            return value
        return value[:MAX_STRING_CHARS] + f"… ({len(value) - MAX_STRING_CHARS} more characters)"
    if isinstance(value, bool | int | float) or value is None:
        return value
    if depth >= MAX_DEPTH:
        return "(nested too deep to keep)"
    if isinstance(value, Mapping):
        return {str(key): _cut(item, depth + 1) for key, item in list(value.items())[:50]}
    if isinstance(value, list | tuple):
        kept = [_cut(item, depth + 1) for item in value[:50]]
        if len(value) > 50:
            kept.append(f"({len(value) - 50} more items)")
        return kept
    return str(value)[:MAX_STRING_CHARS]


def clip(event: Mapping[str, Any], *, show_reasoning: bool) -> dict[str, Any]:
    """One event, cut down to what the log keeps."""
    kind = str(event.get("type") or "")
    shaped: dict[str, Any]
    if kind.startswith(_REASONING) and not show_reasoning:
        shaped = {key: value for key, value in event.items() if key not in _REASONING_TEXT}
        if any(key in event for key in _REASONING_TEXT):
            shaped["omitted"] = "reasoning, which this agent does not show"
        shaped = _cut(shaped)
    elif kind == "CUSTOM" and str(event.get("name") or "").startswith("blob.file."):
        value = event.get("value")
        if isinstance(value, Mapping) and isinstance(value.get("data"), str):
            value = {**value, "data": f"({len(value['data'])} characters of base64)"}
        shaped = _cut({**event, "value": value})
    else:
        shaped = _cut(event)
    if len(json.dumps(shaped, default=str)) > MAX_EVENT_CHARS:
        return {
            "type": kind or "(no type)",
            "omitted": "too large to keep",
            "keys": sorted(str(key) for key in event)[:20],
        }
    return shaped


class Trail:
    """The newest `MAX_EVENTS` events of one run, across every round it streamed."""

    def __init__(self, *, show_reasoning: bool) -> None:
        self._show_reasoning = show_reasoning
        self._kept: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)
        self._total = 0
        self._started = time.monotonic()
        #: Which round of a run that used Blob's tools the next events belong to.
        self.round = 0

    def add(self, event: Mapping[str, Any]) -> None:
        """Keep one event. Never raises: this is called for every event a run streams,
        from inside the stream, and a log that broke the run it was logging would turn a
        diagnostic into the fault."""
        self._total += 1
        try:
            kept = clip(event, show_reasoning=self._show_reasoning)
        except Exception:
            log.warning("could not keep a run event", exc_info=True)
            kept = {"type": str(event.get("type") or "(no type)"), "omitted": "could not be kept"}
        self._kept.append(
            {
                "ms": int((time.monotonic() - self._started) * 1000),
                "round": self.round,
                "event": kept,
            }
        )

    def stored(self) -> dict[str, Any] | None:
        """What `agent_runs.events` holds: how many events came, and the newest of them.
        None for a run that streamed nothing."""
        if self._total == 0:
            return None
        return {"total": self._total, "kept": list(self._kept)}
