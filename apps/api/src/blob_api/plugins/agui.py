"""The AG-UI protocol, as a pure function of bytes.

AG-UI is an open, event-based protocol for agents talking to user-facing applications,
implemented on the agent side by LangGraph, PydanticAI, CrewAI, the Claude Agent SDK and
others. Supporting it means an app whose entire Blob-specific code is a manifest can
answer in a channel: no webhook handler, no bot token, no glue.

Direction is the decision worth stating first. **Blob is the client; the agent is the
server.** Every one of those frameworks ships an AG-UI *server* and none ships a client
that pushes into somebody else's inbox, so making the agent push would recreate exactly
the bespoke glue this exists to delete.

Nothing here does I/O. It takes bytes and returns what Blob should write, which is what
makes the protocol's ordering rules testable without a server on the other end. The SSE
decoding lives in `lib/sse.py`: it was here until a model provider's stream needed the
same wire format, and it never knew anything about AG-UI.

Three details cost more to rediscover than to record:

- **Wire type values are SCREAMING_SNAKE.** The published docs use PascalCase headings
  (`TextMessageStart`) because those are the TypeScript interface names; the string on
  the wire is `TEXT_MESSAGE_START`. Matching the headings parses nothing.
- **Field names are camelCase**, in every SDK, including the Python one — it declares
  `message_id` but serialises through an alias generator.
- **Unknown event types are ignored, never fatal.** The protocol reached 1.0 in September
  2026 and still gains events; a strict discriminated union would turn next month's
  addition into a dead agent. What Blob does with each one is pinned against the official
  SDK in `tests/test_agui_conformance.py`.
- **A version is learned, not assumed.** An agent states its own in
  `RUN_STARTED.protocolVersion`, and Blob sends 1.0's input fields — the version itself,
  content parts — only to an agent that has said it speaks 1.0, because parsers from
  before the field refuse members they do not know.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..lib import jsonpatch
from ..schemas.models import Message

log = logging.getLogger("blob.plugins.agui")

#: One Blob row's worth of agent text. A longer message is split into parts rather than
#: truncated: losing the end of an answer silently is worse than showing two rows.
MAX_BODY_CHARS = 12_000

#: How many messages one run may post, however many it emits.
MAX_MESSAGES_PER_RUN = 10

#: Tool names listed under an answer. Matches the block element cap.
TOOL_LINE_LIMIT = 5

#: Roles AG-UI allows on a text message. "tool" is deliberately not among them.
_TEXT_ROLES = frozenset({"developer", "system", "assistant", "user"})

#: How much of an interrupt Blob keeps: a handful of questions, each a few kilobytes.
#: An agent that stops to ask must be able to be answered, not to store a document.
INTERRUPT_MAX_ITEMS = 8
INTERRUPT_MAX_BYTES = 4 * 1024

#: The folded shared state a run may leave behind for its resume. Beyond this the state
#: is dropped and the resume runs without it — the agent still gets the conversation.
STATE_MAX_BYTES = 64 * 1024

#: Buttons a decision may offer. Matches the block element cap.
DECISION_MAX_CHOICES = 5

#: How much of an agent's `RUN_ERROR` message Blob keeps. It is stored on the run and
#: broadcast to the channel, and an agent can put anything in it.
ERROR_MAX_CHARS = 500

#: A protocol version as AG-UI writes one: MAJOR.MINOR, compared numerically. A patch
#: number some producers add is accepted and dropped — the protocol does not version by it.
_VERSION_RE = re.compile(r"^(\d{1,4})\.(\d{1,4})(?:\.\d{1,6})?$")

#: The version Blob speaks, sent as `protocolVersion` to an agent that has said it
#: speaks at least this.
PROTOCOL_VERSION = "1.0"

#: Usage entries kept from one terminal event, and the token counts each may carry.
USAGE_MAX_ENTRIES = 8
_USAGE_COUNTS = (
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
)

#: Artifacts one run may publish into a work channel (ADR 0014), and how big each may be.
ARTIFACT_MAX_ITEMS = 10
ARTIFACT_MAX_BYTES = 200_000
ARTIFACT_KINDS = frozenset({"diff", "html", "markdown"})

#: Files one run may hand over (`blob.file.*`), and how many bytes of them in all. The
#: budget is the worker's memory rather than the workspace's upload limit — the pieces are
#: held until the stream ends — which is why it is per run and smaller. The job applies
#: the workspace's limit to each file on top of this.
FILE_MAX_ITEMS = 10
FILE_MAX_BYTES = 25 * 1024 * 1024

#: The three events a file travels as. The triad is the protocol's own shape for text
#: (`TEXT_MESSAGE_START`/`CONTENT`/`END`), so an agent author has seen it before.
FILE_EVENTS = frozenset({"blob.file.start", "blob.file.chunk", "blob.file.end"})

#: Lines of "couldn't attach" under one message, matching the block element cap; the
#: last one says how many more there were rather than dropping them silently.
NOTE_LINE_LIMIT = 5


@dataclass(slots=True)
class AgentFile:
    """A file an agent handed over, whole, for the job to check and store."""

    name: str
    #: The type the agent claimed, or None when it did not say — the job guesses from the
    #: name. A claim is only a claim: the job sniffs the bytes before trusting it.
    mime: str | None
    data: bytes


#: How much of one tool call's arguments Blob keeps. A call is a handful of fields — the
#: longest is a post's text — and a megabyte of "arguments" is not a call Blob will run.
TOOL_ARGS_MAX_CHARS = 32 * 1024


@dataclass(slots=True)
class ToolCall:
    """A tool call the agent made in its stream, as Blob heard it.

    Kept for every call, because a call to one of Blob's own tools (ADR 0022) is a request
    Blob runs once the stream ends — the agent stops and waits, as AG-UI's client-executed
    tools do. A call the agent ran itself reports its own `TOOL_CALL_RESULT`, and is only
    shown.
    """

    id: str
    name: str
    arguments: str = ""
    #: Past `TOOL_ARGS_MAX_CHARS`: kept as a call, never run.
    oversized: bool = False

    def parsed_arguments(self) -> dict[str, Any] | None:
        """The arguments as an object, or None if they are not one."""
        if self.oversized:
            return None
        try:
            value = json.loads(self.arguments) if self.arguments.strip() else {}
        except ValueError:
            return None
        return value if isinstance(value, dict) else None


@dataclass(slots=True)
class _Arriving:
    """A file between its start and its end."""

    name: str
    mime: str | None
    declared: int | None
    buffer: bytearray = field(default_factory=bytearray)


@dataclass(slots=True)
class Post:
    """One Blob message a run wants written."""

    agui_message_id: str
    #: 1 unless a long message had to be split; see MAX_BODY_CHARS.
    part: int
    body: str
    tools: list[str] = field(default_factory=list)
    #: What the agent handed over with this message. Empty for most answers.
    files: list[AgentFile] = field(default_factory=list)
    #: Blob's own lines about files that did not make it, shown under the message. Never
    #: the agent's words: an absence is the failure nobody in a channel can diagnose.
    notes: list[str] = field(default_factory=list)
    #: This post's place among the run's posts, from 1. What its client id is made of.
    ordinal: int = 1

    def client_msg_id(self, run_id: str) -> str:
        """The post's idempotency key: the run it belongs to, and its place in that run.

        `run_id` is the `agent_runs` row, which is the run ledger: the job writes at most
        one row per trigger, agent and parent (`agent_runs.start`), so a redelivered job
        never streams a second time and never reaches here. Within one run the ordinal is
        what keeps posts apart. It used to be the agent's own `messageId`, which an agent
        may reuse — and a second message under a reused id met the unique index on
        `(channel_id, author_id, client_msg_id)` and was dropped without a word.
        """
        return f"agui:{run_id}:{self.ordinal}"

    def blocks(self) -> list[dict[str, Any]] | None:
        """Context lines under the answer — the tools it used, the files that did not
        make it — or None when there is nothing to say.

        Blob builds these, never the agent: the block union is closed, and letting a
        stream mint interactive UI would be a rendering surface nobody reviewed.
        """
        blocks: list[dict[str, Any]] = []
        if self.tools:
            listed = ", ".join(self.tools[:TOOL_LINE_LIMIT])
            more = len(self.tools) - TOOL_LINE_LIMIT
            if more > 0:
                listed += f" and {more} more"
            blocks.append(
                {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Used {listed}"}]}
            )
        if self.notes:
            lines = self.notes[:NOTE_LINE_LIMIT]
            if len(self.notes) > NOTE_LINE_LIMIT:
                extra = len(self.notes) - NOTE_LINE_LIMIT + 1
                lines = [*self.notes[: NOTE_LINE_LIMIT - 1], f"…and {extra} more files."]
            blocks.append(
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": line} for line in lines],
                }
            )
        return blocks or None


class Fold:
    """Reduces an AG-UI event stream into the messages Blob will write.

    Tolerant by construction. An unknown type is dropped, a delta for a message that was
    never opened opens it, and anything still open when the stream ends is flushed rather
    than discarded. A strict verifier would convert a producer's small bug into silence,
    and silence is the one failure a person in a channel cannot diagnose.
    """

    def __init__(
        self,
        *,
        max_body_chars: int = MAX_BODY_CHARS,
        max_file_bytes: int = FILE_MAX_BYTES,
        state: Any = None,
    ) -> None:
        self._max_body = max_body_chars
        self._open: dict[str, list[str]] = {}
        #: Messages the agent opened under somebody else's role — quoting the person back,
        #: or a system line. Their text is not the agent's answer, so every delta for them
        #: is dropped until they end.
        self._ignored: set[str] = set()
        self._part: dict[str, int] = {}
        self._tools: list[str] = []
        self._calls: dict[str, str] = {}
        #: Every tool call in the stream, in order, with its arguments.
        self.tool_calls: dict[str, ToolCall] = {}
        #: Calls the agent reported a result for itself — its own tools, not Blob's.
        self._answered_calls: set[str] = set()
        self._posted = 0
        #: The last message sealed. Nothing is written until the stream ends, so a file
        #: or a note that arrives after the answer can still join it.
        self._last: Post | None = None
        # Files: between start and end, whole and waiting for a message to ride on, and
        # Blob's notes about the ones that did not make it, waiting likewise.
        self._max_file_bytes = max_file_bytes
        self._arriving: dict[str, _Arriving] = {}
        self._closed_files: set[str] = set()
        self._ready: list[AgentFile] = []
        self._notes: list[str] = []
        self._file_count = 0
        self._file_bytes = 0
        self._said_too_many = False
        self.error: str | None = None
        #: The question the agent stopped to ask, as one line; see `interrupt_prompt`.
        self.interrupt: str | None = None
        #: The raw `interrupts[]` from RUN_FINISHED, kept so a resume can name what it
        #: answers. None unless the run ended in an interrupt.
        self.interrupts: list[dict[str, Any]] | None = None
        #: Shared state, folded from STATE_SNAPSHOT and STATE_DELTA. Handed back as
        #: `state` when the run resumes, which is the whole reason to keep it. It starts
        #: as the state the run was sent, because that is what a `STATE_DELTA` patches.
        self.state: Any = state
        self.state_dropped = False
        #: Whether the agent said anything about state this run. One that did not leaves
        #: the remembered state alone rather than writing back what it was given.
        self.state_touched = False
        #: `CUSTOM` events named `blob.artifact`: what the agent made, for a work channel.
        #: Kept here as data; the job decides whether there is a work channel to put
        #: them in. Anywhere else they are inert.
        self.artifacts: list[dict[str, str]] = []
        self.finished = False
        #: The protocol version the agent declared in `RUN_STARTED.protocolVersion` —
        #: its own, never an echo of Blob's. None when it said nothing, which is what an
        #: agent from before 1.0 says.
        self.protocol_version: str | None = None
        #: Token usage the agent reported on its terminal event, one entry per provider
        #: and model. None when it reported none.
        self.usage: list[dict[str, Any]] | None = None
        #: The agent ended the run as cancelled (`outcome: {type: "cancelled"}`), which
        #: is neither an answer nor a failure.
        self.cancelled = False
        #: The HTTP status the agent refused the run with, when it refused it outright.
        #: Set by the transport, which is the only thing that sees one.
        self.rejected_status: int | None = None

    @property
    def posted(self) -> int:
        return self._posted

    def feed(self, event: Mapping[str, Any]) -> list[Post]:
        kind = event.get("type")
        if not isinstance(kind, str):
            return []

        if kind == "TEXT_MESSAGE_START":
            message_id = _message_id(event)
            if _quoting(event):
                # The agent is quoting somebody back at us; not its own answer. Its
                # deltas have to be refused too, or the first one reopens the message
                # through `_append` and the quote is posted as the bot's own words.
                self._ignored.add(message_id)
                return []
            self._ignored.discard(message_id)
            self._open.setdefault(message_id, [])
            return []

        if kind in ("TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"):
            message_id = _message_id(event)
            if kind == "TEXT_MESSAGE_CHUNK" and "role" in event:
                # The compact form carries its role on the chunk itself, so a chunk can
                # start a quote or say the agent is speaking again.
                if _quoting(event):
                    self._ignored.add(message_id)
                else:
                    self._ignored.discard(message_id)
            if message_id in self._ignored:
                return []
            delta = event.get("delta")
            if not isinstance(delta, str) or not delta:
                return []  # An empty delta is legal and carries no text.
            return self._append(message_id, delta)

        if kind == "TEXT_MESSAGE_END":
            message_id = _message_id(event)
            if message_id in self._ignored:
                # Over. Forgotten, so an id the agent reuses for its own words later —
                # the "default" fallback above all — is not refused for the rest of the run.
                self._ignored.discard(message_id)
                return []
            return self._seal(message_id)

        if kind in ("TOOL_CALL_START", "TOOL_CALL_CHUNK"):
            name = event.get("toolCallName")
            call_id = event.get("toolCallId")
            if isinstance(name, str) and name and isinstance(call_id, str) and call_id:
                self.tool_calls.setdefault(call_id, ToolCall(id=call_id, name=name))
            if kind == "TOOL_CALL_CHUNK":
                self._take_arguments(event)
            if isinstance(name, str) and name:
                if isinstance(call_id, str) and self._calls.get(call_id) == name:
                    return []  # A chunk repeating what its start already said.
                if isinstance(call_id, str):
                    self._calls[call_id] = name
                if name not in self._tools:
                    self._tools.append(name)
            return []

        if kind == "TOOL_CALL_ARGS":
            self._take_arguments(event)
            return []

        if kind == "TOOL_CALL_RESULT":
            call_id = event.get("toolCallId")
            if isinstance(call_id, str):
                self._answered_calls.add(call_id)
            return []

        if kind == "RUN_STARTED":
            declared = event.get("protocolVersion")
            matched = _VERSION_RE.match(declared) if isinstance(declared, str) else None
            if matched:
                self.protocol_version = f"{int(matched.group(1))}.{int(matched.group(2))}"
            return []

        if kind == "RUN_ERROR":
            message = event.get("message")
            self.error = (
                message[:ERROR_MAX_CHARS] if isinstance(message, str) and message else None
            ) or "no reason given"
            self.usage = usage_of(event)
            self.finished = True
            return self.finish()

        if kind == "RUN_FINISHED":
            self.finished = True
            self.interrupts = interrupts_of(event)
            self.interrupt = interrupt_prompt(self.interrupts)
            self.usage = usage_of(event)
            outcome = event.get("outcome")
            self.cancelled = isinstance(outcome, Mapping) and outcome.get("type") == "cancelled"
            return self.finish()

        if kind == "CUSTOM" and event.get("name") == "blob.artifact":
            self._take_artifact(event.get("value"))
            return []

        if kind == "CUSTOM" and event.get("name") in FILE_EVENTS:
            self._take_file_event(str(event.get("name")), event.get("value"))
            return []

        if kind == "STATE_SNAPSHOT":
            self._take_state(event.get("snapshot"))
            return []

        if kind == "STATE_DELTA":
            delta = event.get("delta")
            if self.state_dropped or not isinstance(delta, list):
                return []
            try:
                self._take_state(jsonpatch.apply(self.state, delta, max_bytes=STATE_MAX_BYTES))
            except jsonpatch.PatchTooLargeError:
                # Bounded while it applies, so an overflow is caught before it is built;
                # the outcome is the one `_take_state` gives a state that arrives too big.
                self.state = None
                self.state_dropped = True
                log.info("agui: shared state over %d bytes was dropped", STATE_MAX_BYTES)
            except jsonpatch.PatchError:
                # Keep the last good state rather than half of a patch: a resume handed
                # a state the agent never had is worse than one handed no state.
                log.info("agui: a STATE_DELTA did not apply; keeping the last snapshot")
            return []

        # Everything else — STEP_*, ACTIVITY_*, SUBAGENT_*, MESSAGES_SNAPSHOT, every
        # REASONING_* and THINKING_* event, TOOL_CALL_END, RAW, CUSTOM —
        # posts nothing; the live card (`run_card.CardFold`) draws what of it is drawn.
        # Reasoning in particular is never posted: it is the agent's working-out, not its
        # answer.
        return []

    def _take_arguments(self, event: Mapping[str, Any]) -> None:
        """A piece of a call's arguments: for the call it names, or the newest one."""
        delta = event.get("delta")
        if not isinstance(delta, str) or not delta:
            return
        call_id = event.get("toolCallId")
        call = (
            self.tool_calls.get(call_id)
            if isinstance(call_id, str)
            else next(reversed(self.tool_calls.values()), None)
        )
        if call is None or call.oversized:
            return
        if len(call.arguments) + len(delta) > TOOL_ARGS_MAX_CHARS:
            call.oversized = True
            call.arguments = ""
            return
        call.arguments += delta

    def client_calls(self, names: Collection[str]) -> list[ToolCall]:
        """The calls the agent left for Blob to run: to a tool Blob offered, and with no
        result the agent reported itself."""
        return [
            call
            for call in self.tool_calls.values()
            if call.name in names and call.id not in self._answered_calls
        ]

    def _take_artifact(self, value: Any) -> None:
        """Keep a well-formed artifact; log and drop anything else. Never fatal."""
        if len(self.artifacts) >= ARTIFACT_MAX_ITEMS:
            log.info("agui: more than %d artifacts in one run; dropping", ARTIFACT_MAX_ITEMS)
            return
        if not isinstance(value, Mapping):
            return
        kind, title, body = value.get("kind"), value.get("title"), value.get("body")
        if kind not in ARTIFACT_KINDS or not isinstance(title, str) or not isinstance(body, str):
            log.info("agui: an artifact was malformed; dropped")
            return
        if not title.strip() or not body.strip():
            return
        if len(body.encode("utf-8")) > ARTIFACT_MAX_BYTES:
            log.info("agui: an artifact over %d bytes was dropped", ARTIFACT_MAX_BYTES)
            return
        self.artifacts.append({"kind": kind, "title": title.strip()[:200], "body": body})

    def _take_file_event(self, name: str, value: Any) -> None:
        """One piece of a file on its way. Never fatal: a bad file is dropped and said
        so, and the answer it came with is posted regardless."""
        if not isinstance(value, Mapping):
            return
        file_id = value.get("id")
        if not isinstance(file_id, str) or not file_id:
            return
        if name == "blob.file.start":
            self._start_file(file_id, value)
        elif name == "blob.file.chunk":
            self._file_piece(file_id, value.get("data"))
        else:
            self._end_file(file_id)

    def _start_file(self, file_id: str, value: Mapping[str, Any]) -> None:
        if file_id in self._arriving or file_id in self._closed_files:
            return  # A repeated start is noise, not a second file.
        raw_name = value.get("name")
        name = display_name(raw_name) if isinstance(raw_name, str) else ""
        if not name:
            self._closed_files.add(file_id)
            log.info("agui: a file arrived with no name; dropped")
            return
        if self._file_count >= FILE_MAX_ITEMS:
            self._closed_files.add(file_id)
            if not self._said_too_many:
                self._said_too_many = True
                self._notes.append(f"Only the first {FILE_MAX_ITEMS} files were attached.")
            return
        declared = value.get("size")
        declared = declared if isinstance(declared, int) and declared >= 0 else None
        if declared is not None and self._file_bytes + declared > self._max_file_bytes:
            # Refused before a byte of it is held, rather than after most of it is.
            self._closed_files.add(file_id)
            self._notes.append(_too_large(name))
            return
        mime = value.get("mimeType")
        claimed = mime.lower().split(";", 1)[0].strip() if isinstance(mime, str) else ""
        self._file_count += 1
        self._arriving[file_id] = _Arriving(name=name, mime=claimed or None, declared=declared)

    def _file_piece(self, file_id: str, data: Any) -> None:
        arriving = self._arriving.get(file_id)
        if arriving is None or not isinstance(data, str):
            return
        try:
            piece = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            self._drop_file(file_id, f"Couldn't attach `{arriving.name}`: it arrived damaged.")
            return
        if self._file_bytes + len(piece) > self._max_file_bytes:
            self._drop_file(file_id, _too_large(arriving.name))
            return
        arriving.buffer.extend(piece)
        self._file_bytes += len(piece)

    def _end_file(self, file_id: str) -> None:
        arriving = self._arriving.get(file_id)
        if arriving is None:
            return
        if arriving.declared is not None and arriving.declared != len(arriving.buffer):
            self._drop_file(file_id, f"Couldn't attach `{arriving.name}`: it arrived incomplete.")
            return
        del self._arriving[file_id]
        self._closed_files.add(file_id)
        self._ready.append(
            AgentFile(name=arriving.name, mime=arriving.mime, data=bytes(arriving.buffer))
        )

    def _drop_file(self, file_id: str, note: str) -> None:
        arriving = self._arriving.pop(file_id, None)
        self._closed_files.add(file_id)
        if arriving is not None:
            # What it held is released, so the budget measures what is actually kept.
            self._file_bytes -= len(arriving.buffer)
        self._notes.append(note)
        log.info("agui: a file was dropped: %s", note)

    def _take_state(self, state: Any) -> None:
        """Keep the state if it fits; drop it for the rest of the run if it does not."""
        self.state_touched = True
        try:
            size = len(json.dumps(state, separators=(",", ":"), default=str))
        except (TypeError, ValueError):
            size = STATE_MAX_BYTES + 1
        if size > STATE_MAX_BYTES:
            self.state = None
            self.state_dropped = True
            log.info("agui: shared state over %d bytes was dropped", STATE_MAX_BYTES)
            return
        self.state = state

    def finish(self) -> list[Post]:
        """Seal every message still open, oldest first, and settle the files.

        A file still arriving when the stream ends did not arrive, and says so. Whole
        files and notes ride on the message sealed next or, failing that, on the last one
        sealed; only a run that posted nothing at all gives them a message of their own.
        Safe to call twice — the second call finds nothing left to do.
        """
        for file_id, arriving in list(self._arriving.items()):
            note = f"Couldn't attach `{arriving.name}`: it never finished arriving."
            self._drop_file(file_id, note)
        posts: list[Post] = []
        for message_id in list(self._open):
            posts.extend(self._seal(message_id))
        if self._ready or self._notes:
            if self._last is not None:
                self._last.files.extend(self._ready)
                self._last.notes.extend(self._notes)
            else:
                self._posted += 1
                tools, self._tools = self._tools, []
                self._last = Post(
                    agui_message_id="files",
                    part=1,
                    body="",
                    tools=tools,
                    files=self._ready,
                    notes=self._notes,
                    ordinal=self._posted,
                )
                posts.append(self._last)
            self._ready, self._notes = [], []
        return posts

    def _append(self, message_id: str, delta: str) -> list[Post]:
        buffer = self._open.setdefault(message_id, [])
        buffer.append(delta)
        if sum(len(piece) for piece in buffer) <= self._max_body:
            return []
        # Overflow becomes a continuation row rather than a truncation or an edit, so
        # the invariant holds: every row is complete at the moment it is written.
        whole = "".join(buffer)
        head, tail = whole[: self._max_body], whole[self._max_body :]
        post = self._emit(message_id, head)
        self._open[message_id] = [tail]
        self._part[message_id] = self._part.get(message_id, 1) + 1
        return [post] if post else []

    def _seal(self, message_id: str) -> list[Post]:
        buffer = self._open.pop(message_id, None)
        if buffer is None:
            return []
        post = self._emit(message_id, "".join(buffer))
        return [post] if post else []

    def _emit(self, message_id: str, raw: str) -> Post | None:
        body = raw.strip()
        if not body or self._posted >= MAX_MESSAGES_PER_RUN:
            return None
        self._posted += 1
        tools, self._tools = self._tools, []
        files, self._ready = self._ready, []
        notes, self._notes = self._notes, []
        self._last = Post(
            agui_message_id=message_id,
            part=self._part.get(message_id, 1),
            body=body,
            tools=tools,
            files=files,
            notes=notes,
            ordinal=self._posted,
        )
        return self._last


#: Characters a file name keeps. Control characters would forge lines in a note or a log;
#: a backtick would close the code span the name is shown in.
_NAME_DROPS = {chr(n) for n in range(32)} | {"\x7f", "`"}
_NAME_MAX_CHARS = 200


def display_name(raw: str) -> str:
    """The name an agent gave a file, as Blob will show and store it.

    Only the last path segment: an agent that sends `/opt/data/site/index.html` means the
    file, and the rest of its disk is nobody's business. Long names keep their end, which
    is where the extension is.
    """
    last = raw.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(c for c in last if c not in _NAME_DROPS).strip()
    return cleaned[-_NAME_MAX_CHARS:]


def _too_large(name: str) -> str:
    return f"Couldn't attach `{name}`: it's more than an agent may hand over in one run."


def _quoting(event: Mapping[str, Any]) -> bool:
    """Whether a text event carries a role that is not the agent's own.

    `role` is optional and defaults to the assistant; only a role AG-UI defines for text
    counts, so a value nobody has defined yet is read as the agent talking.
    """
    role = event.get("role", "assistant")
    return role in _TEXT_ROLES and role != "assistant"


def _message_id(event: Mapping[str, Any]) -> str:
    """The correlation key, with a fallback.

    `messageId` is optional on the chunk events and required only on the first of a
    message. An agent that omits it everywhere still gets one coherent message rather
    than one per delta.
    """
    value = event.get("messageId")
    return value if isinstance(value, str) and value else "default"


def speaks(declared: str | None, version: str = PROTOCOL_VERSION) -> bool:
    """Whether an agent that declared `declared` speaks at least `version`.

    MAJOR.MINOR compared numerically, component by component — `1.10` is newer than
    `1.9`. An agent that never declared one speaks something older than the field.
    """
    have = _VERSION_RE.match(declared) if declared is not None else None
    want = _VERSION_RE.match(version)
    if have is None or want is None:
        return False
    return (int(have.group(1)), int(have.group(2))) >= (int(want.group(1)), int(want.group(2)))


def usage_of(event: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    """The token usage a terminal event reported, kept to what AG-UI defines.

    A list, one entry per provider and model. Only the named counts are kept, and only as
    non-negative integers; `provider` and `model` are trimmed. Anything else the agent put
    there is dropped rather than stored, since it is stored and shown.
    """
    raw = event.get("usage")
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return None
    kept: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        entry: dict[str, Any] = {}
        for key in ("provider", "model"):
            value = item.get(key)
            if isinstance(value, str) and value:
                entry[key] = value[:80]
        for key in _USAGE_COUNTS:
            value = item.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                entry[key] = value
        if any(key in entry for key in _USAGE_COUNTS):
            kept.append(entry)
        if len(kept) >= USAGE_MAX_ENTRIES:
            break
    return kept or None


def total_tokens(usage: Sequence[Mapping[str, Any]] | None) -> int | None:
    """One number for a run's usage: each entry's total, or its input and output."""
    if not usage:
        return None
    total = 0
    for entry in usage:
        if isinstance(entry.get("totalTokens"), int):
            total += int(entry["totalTokens"])
        else:
            total += int(entry.get("inputTokens") or 0) + int(entry.get("outputTokens") or 0)
    return total


def interrupts_of(event: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    """The `interrupts[]` a RUN_FINISHED carried, capped, or None if it ended cleanly.

    `outcome: {type: "interrupt", interrupts: [...]}` is how AG-UI says "I stopped to
    ask". Each item may carry `id`, `reason`, `message`, `responseSchema`, `expiresAt`
    and `metadata`; the ids are what a resume echoes back, so the items are kept whole
    rather than reduced to their text.
    """
    outcome = event.get("outcome")
    if not isinstance(outcome, Mapping) or outcome.get("type") != "interrupt":
        return None
    raw = outcome.get("interrupts")
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    kept: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        as_dict = dict(item)
        try:
            size = len(json.dumps(as_dict, separators=(",", ":"), default=str))
        except (TypeError, ValueError):
            continue
        if size > INTERRUPT_MAX_BYTES:
            log.info("agui: an interrupt over %d bytes was dropped", INTERRUPT_MAX_BYTES)
            continue
        kept.append(as_dict)
        if len(kept) >= INTERRUPT_MAX_ITEMS:
            break
    return kept


def interrupt_prompt(interrupts: Sequence[Mapping[str, Any]] | None) -> str | None:
    """The question an agent stopped to ask, as one line, or None if it did not stop."""
    if interrupts is None:
        return None
    for item in interrupts:
        for key in ("message", "reason", "value"):
            text = item.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
    return "The agent is waiting on a decision."


@dataclass(slots=True)
class Choice:
    label: str
    value: Any


@dataclass(slots=True)
class Decision:
    """What the person is being asked, and how they may answer it.

    Choices come only from what the agent declared — a JSON-schema `enum`, `oneOf` with
    `const`/`title`, a boolean, or `metadata.options` — never from Blob guessing at the
    prose. No declared choices means a free-text answer.
    """

    prompt: str
    choices: list[Choice]
    interrupt_ids: list[str]
    expires_at: datetime | None

    @property
    def free_text(self) -> bool:
        return not self.choices


def decision_of(interrupts: Sequence[Mapping[str, Any]] | None) -> Decision:
    """The question to put to the person: the first interrupt, whole.

    An agent may stop with several questions at once. Each is self-contained — its own
    message, its own `responseSchema` — so the card asks the first, prompt and choices
    from the same one; it used to take the prompt from one and the buttons from whichever
    came first with choices. The resume answers that one and marks the rest cancelled
    (`resume_entries`), and an agent that still needs them asks again.
    """
    items = list(interrupts or [])
    first = items[0] if items else {}
    prompt = interrupt_prompt([first] if items else None) or "The agent is waiting on a decision."
    ids = [str(item["id"]) for item in items if isinstance(item.get("id"), str) and item["id"]]
    return Decision(
        prompt=prompt,
        choices=_choices_of(first)[:DECISION_MAX_CHOICES],
        interrupt_ids=ids or ["default"],
        expires_at=_earliest_expiry(items),
    )


def resume_entries(interrupt_ids: Sequence[str], answer: Any) -> list[dict[str, Any]]:
    """What a resume tells the agent: the question that was asked answered, the rest
    cancelled.

    AG-UI 1.0 wants one entry per interrupt, each `resolved` or `cancelled`. Every id
    used to be resolved with the one answer the person gave to the one question they
    were shown — an answer to "deploy to production?" handed to "which region?" too.
    """
    ids = list(interrupt_ids) or ["default"]
    first, rest = ids[0], ids[1:]
    return [
        {"interruptId": first, "status": "resolved", "payload": answer},
        *({"interruptId": other, "status": "cancelled"} for other in rest),
    ]


def _choices_of(item: Mapping[str, Any]) -> list[Choice]:
    schema = item.get("responseSchema")
    if isinstance(schema, Mapping):
        enum = schema.get("enum")
        if isinstance(enum, list) and enum and all(isinstance(v, str) for v in enum):
            return [Choice(label=v, value=v) for v in enum]
        one_of = schema.get("oneOf")
        if isinstance(one_of, list) and one_of:
            found: list[Choice] = []
            for option in one_of:
                if not isinstance(option, Mapping) or "const" not in option:
                    continue
                title = option.get("title")
                label = title if isinstance(title, str) and title else str(option["const"])
                found.append(Choice(label=label, value=option["const"]))
            if found:
                return found
        if schema.get("type") == "boolean":
            return [Choice(label="Yes", value=True), Choice(label="No", value=False)]
    metadata = item.get("metadata")
    if isinstance(metadata, Mapping):
        for key in ("options", "choices"):
            options = metadata.get(key)
            if not isinstance(options, list) or not options:
                continue
            found = []
            for option in options:
                if isinstance(option, str) and option:
                    found.append(Choice(label=option, value=option))
                elif isinstance(option, Mapping):
                    text_label = option.get("label")
                    if isinstance(text_label, str) and text_label:
                        found.append(
                            Choice(label=text_label, value=option.get("value", text_label))
                        )
            if found:
                return found
    return []


def _earliest_expiry(items: Sequence[Mapping[str, Any]]) -> datetime | None:
    earliest: datetime | None = None
    for item in items:
        raw = item.get("expiresAt")
        if not isinstance(raw, str):
            continue
        try:
            when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            continue
        if earliest is None or when < earliest:
            earliest = when
    return earliest


def to_agui_messages(
    messages: Sequence[Message],
    *,
    bot_user_id: str,
    names: Mapping[str, str],
    parts: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    """Blob history as AG-UI `Message[]`, oldest first.

    The listening bot's own rows become `assistant`; everyone else — people and other
    apps' bots alike — becomes `user` with a `name`. To the agent, another bot is simply
    another participant, which is the same thing it is to a person reading the channel.

    A message with files says so in its text, whatever the agent speaks: "[attached:
    report.pdf]". A message that was only a file used to be dropped altogether, so the
    agent was asked about a document it was never told existed. `parts` carries the
    files themselves, as AG-UI 1.0 content parts keyed by message id — given only for an
    agent that speaks 1.0, because an older parser refuses a list where it expects text.
    """
    out: list[dict[str, Any]] = []
    for message in messages:
        if message.deleted_at or message.kind == "system":
            continue
        text = _with_attachment_line(message)
        if not text:
            continue
        mine = message.author_id == bot_user_id
        content: str | list[dict[str, Any]] = text
        extra = parts.get(message.id) if parts and not mine else None
        if extra:
            content = [{"type": "text", "text": text}, *(dict(part) for part in extra)]
        entry: dict[str, Any] = {
            "id": message.id,
            "role": "assistant" if mine else "user",
            "content": content,
        }
        if not mine:
            entry["name"] = names.get(message.author_id or "", "someone")
        out.append(entry)
    return out


def _with_attachment_line(message: Message) -> str:
    """The body, and a line naming the files that came with it.

    A voice note's transcript is already its body, so a recording is not named again.
    """
    named = [a.filename for a in message.attachments if a.kind != "voice"]
    if not named:
        return message.body
    line = f"[attached: {', '.join(named)}]"
    return f"{message.body}\n{line}" if message.body else line


def build_run_input(
    *,
    thread_id: str,
    run_id: str,
    messages: list[dict[str, Any]],
    channel_name: str,
    trigger_user: str,
    asked_by_agent: str | None = None,
    on_behalf_of: str | None = None,
    participants: Sequence[str] = (),
    state: Any = None,
    parent_run_id: str | None = None,
    resume: Sequence[Mapping[str, Any]] | None = None,
    instructions: str | None = None,
    protocol_version: str | None = None,
    tools: Sequence[Mapping[str, Any]] = (),
    task: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The POST body.

    camelCase throughout, and `state`, `tools`, `context` and `forwardedProps` are sent
    explicitly rather than omitted: the published Python model declares them required, so
    leaving them out is a 422 from every FastAPI-hosted agent — a failure that looks like
    the agent being broken.

    `parentRunId` and `resume` are the opposite case: newer optional fields that an agent
    built on an older model with `extra="forbid"` would refuse. They are present only
    when this run resumes one that stopped to ask, which is the only time they mean
    anything.

    `tools` are Blob's own, offered only to an agent an admin allowed them (ADR 0022):
    client-executed, so Blob runs every call, as the person who asked and inside the room,
    and asks the person before any write. Empty for every other agent.

    The extra context items exist for a chain (ADR 0013): `asked_by_agent` names the agent
    whose reply mentioned this one, `on_behalf_of` the person whose authority the hop runs
    on, and `participants` the other agents in the room, so an agent can address one.
    `task` is the task this run was handed (ADR 0023), as JSON — id, title, instructions,
    priority and due date — beside the hand-off message that says the same in words.

    `protocol_version` is the version Blob speaks, and is sent only to an agent that
    declared it speaks it too (`speaks`): AG-UI 1.0 asks a client to omit it for a peer
    that predates the field, since that peer's parser may refuse any member it does not
    know.

    `instructions` is what the workspace told this agent (`plugins.instructions`), and it
    is the one thing that travels in `forwardedProps` — Janus reads it as an ephemeral
    system prompt for the run. The key is present only when there is something to say: an
    agent receiving `instructions: ""` would prepend an empty line to its prompt, and a
    workspace that has said nothing must leave the wire exactly as it was before this
    existed.
    """
    context: list[dict[str, str]] = [
        {"description": "channel", "value": channel_name},
        {"description": "asked_by", "value": trigger_user},
    ]
    if asked_by_agent:
        context.append({"description": "asked_by_agent", "value": asked_by_agent})
    if on_behalf_of:
        context.append({"description": "on_behalf_of", "value": on_behalf_of})
    if participants:
        context.append({"description": "participants", "value": ", ".join(participants)})
    if task is not None:
        context.append({"description": "task", "value": json.dumps(dict(task))})
    body: dict[str, Any] = {
        "threadId": thread_id,
        "runId": run_id,
        "state": state,
        "messages": messages,
        "tools": [dict(tool) for tool in tools],
        "context": context,
        "forwardedProps": {"instructions": instructions} if instructions else {},
    }
    if protocol_version is not None:
        body["protocolVersion"] = protocol_version
    if parent_run_id is not None:
        body["parentRunId"] = parent_run_id
    if resume is not None:
        body["resume"] = [dict(item) for item in resume]
    return body
