"""Splitting a `text/event-stream` into the JSON objects it carries.

Lifted out of `plugins/agui.py` when a second caller appeared. It was written for AG-UI
and is not specific to it: a model provider's streaming API is the same wire format, and
`lib/llm.py` sits *below* `plugins/`, so reaching up for the decoder would have inverted
the layering to avoid forty duplicated lines. Nothing here knows what the JSON means.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any


class SseDecoder:
    """Splits a `text/event-stream` byte stream into the JSON objects it carries.

    Records end at a blank line, and only `data:` lines are read. `event:`, `id:` and
    `retry:` are ignored on purpose: AG-UI's discriminator is the JSON `type` field, not
    the SSE event name, and an agent that sets both must not be able to disagree with
    itself. Anthropic and OpenAI both set an event name too, and both repeat the same
    discriminator inside the payload.

    Feeding is incremental because a record routinely straddles a chunk boundary — the
    decoder holds a partial line until the rest arrives.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._data: list[str] = []

    def feed(self, chunk: bytes) -> Iterator[dict[str, Any]]:
        # errors="replace" rather than strict: a malformed byte should cost one garbled
        # character, not the remainder of an answer.
        self._buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            yield from self._line(line.rstrip("\r"))

    def close(self) -> Iterator[dict[str, Any]]:
        """Flush whatever arrived without a trailing blank line."""
        if self._buffer:
            line, self._buffer = self._buffer, ""
            yield from self._line(line.rstrip("\r"))
        yield from self._dispatch()

    def _line(self, line: str) -> Iterator[dict[str, Any]]:
        if not line:
            yield from self._dispatch()
            return
        if line.startswith(":"):
            return  # A comment, and the usual shape of a keep-alive.
        name, _, value = line.partition(":")
        if name == "data":
            self._data.append(value[1:] if value.startswith(" ") else value)

    def _dispatch(self) -> Iterator[dict[str, Any]]:
        if not self._data:
            return
        raw, self._data = "\n".join(self._data), []
        if not raw.strip():
            return
        try:
            parsed = json.loads(raw)
        except ValueError:
            return  # Not our business to police; the run continues.
        if isinstance(parsed, dict):
            yield parsed


__all__ = ["SseDecoder"]
