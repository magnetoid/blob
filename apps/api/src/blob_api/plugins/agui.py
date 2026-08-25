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
- **Unknown event types are ignored, never fatal.** The protocol is pre-1.0 and still
  gaining events; a strict discriminated union would turn next month's addition into a
  dead agent. Ten event types are acted on and the rest are inert.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..schemas.models import Message

#: One Blob row's worth of agent text. A longer message is split into parts rather than
#: truncated: losing the end of an answer silently is worse than showing two rows.
MAX_BODY_CHARS = 12_000

#: How many messages one run may post, however many it emits.
MAX_MESSAGES_PER_RUN = 10

#: Tool names listed under an answer. Matches the block element cap.
TOOL_LINE_LIMIT = 5

#: Roles AG-UI allows on a text message. "tool" is deliberately not among them.
_TEXT_ROLES = frozenset({"developer", "system", "assistant", "user"})


@dataclass(slots=True)
class Post:
    """One Blob message a run wants written."""

    agui_message_id: str
    #: 1 unless a long message had to be split; see MAX_BODY_CHARS.
    part: int
    body: str
    tools: list[str] = field(default_factory=list)

    def client_msg_id(self, run_id: str) -> str:
        """Deterministic, so re-running a job cannot post the answer twice.

        This is the whole idempotency story: `messages_client_idem` already covers
        `(channel_id, author_id, client_msg_id)`, so the existing unique index is the run
        ledger and no new table is needed to hold one.
        """
        tail = "" if self.part == 1 else f"#{self.part}"
        return f"agui:{run_id}:{self.agui_message_id}{tail}"

    def blocks(self) -> list[dict[str, Any]] | None:
        """A context block naming the tools the agent used, or None.

        Blob builds this, never the agent: the block union is closed, and letting a
        stream mint interactive UI would be a rendering surface nobody reviewed.
        """
        if not self.tools:
            return None
        listed = ", ".join(self.tools[:TOOL_LINE_LIMIT])
        more = len(self.tools) - TOOL_LINE_LIMIT
        if more > 0:
            listed += f" and {more} more"
        return [{"type": "context", "elements": [{"type": "mrkdwn", "text": f"Used {listed}"}]}]


class Fold:
    """Reduces an AG-UI event stream into the messages Blob will write.

    Tolerant by construction. An unknown type is dropped, a delta for a message that was
    never opened opens it, and anything still open when the stream ends is flushed rather
    than discarded. A strict verifier would convert a producer's small bug into silence,
    and silence is the one failure a person in a channel cannot diagnose.
    """

    def __init__(self, *, max_body_chars: int = MAX_BODY_CHARS) -> None:
        self._max_body = max_body_chars
        self._open: dict[str, list[str]] = {}
        self._part: dict[str, int] = {}
        self._tools: list[str] = []
        self._calls: dict[str, str] = {}
        self._posted = 0
        self.error: str | None = None
        self.interrupt: str | None = None
        self.finished = False

    @property
    def posted(self) -> int:
        return self._posted

    def feed(self, event: Mapping[str, Any]) -> list[Post]:
        kind = event.get("type")
        if not isinstance(kind, str):
            return []

        if kind == "TEXT_MESSAGE_START":
            role = event.get("role", "assistant")
            if role in _TEXT_ROLES and role != "assistant":
                # The agent is quoting somebody back at us; not its own answer.
                return []
            self._open.setdefault(_message_id(event), [])
            return []

        if kind in ("TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"):
            delta = event.get("delta")
            if not isinstance(delta, str) or not delta:
                return []  # An empty delta is legal and carries no text.
            return self._append(_message_id(event), delta)

        if kind == "TEXT_MESSAGE_END":
            return self._seal(_message_id(event))

        if kind in ("TOOL_CALL_START", "TOOL_CALL_CHUNK"):
            name = event.get("toolCallName")
            call_id = event.get("toolCallId")
            if isinstance(name, str) and name:
                if isinstance(call_id, str) and self._calls.get(call_id) == name:
                    return []  # A chunk repeating what its start already said.
                if isinstance(call_id, str):
                    self._calls[call_id] = name
                if name not in self._tools:
                    self._tools.append(name)
            return []

        if kind == "RUN_ERROR":
            message = event.get("message")
            self.error = message if isinstance(message, str) and message else "no reason given"
            self.finished = True
            return self.finish()

        if kind == "RUN_FINISHED":
            self.finished = True
            self.interrupt = _interrupt_prompt(event)
            return self.finish()

        # Everything else — RUN_STARTED, STEP_*, STATE_*, MESSAGES_SNAPSHOT, every
        # REASONING_* and THINKING_* event, TOOL_CALL_ARGS, TOOL_CALL_RESULT, CUSTOM —
        # is deliberately inert. Reasoning in particular is never posted: it is the
        # agent's working-out, not its answer.
        return []

    def finish(self) -> list[Post]:
        """Seal every message still open, oldest first."""
        posts: list[Post] = []
        for message_id in list(self._open):
            posts.extend(self._seal(message_id))
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
        return Post(
            agui_message_id=message_id,
            part=self._part.get(message_id, 1),
            body=body,
            tools=tools,
        )


def _message_id(event: Mapping[str, Any]) -> str:
    """The correlation key, with a fallback.

    `messageId` is optional on the chunk events and required only on the first of a
    message. An agent that omits it everywhere still gets one coherent message rather
    than one per delta.
    """
    value = event.get("messageId")
    return value if isinstance(value, str) and value else "default"


def _interrupt_prompt(event: Mapping[str, Any]) -> str | None:
    """The question an agent stopped to ask, if it stopped to ask one.

    Slice one renders it and stops. There is no resume path: answering means mentioning
    the agent again, which is what a person would do anyway.
    """
    outcome = event.get("outcome")
    if not isinstance(outcome, Mapping) or outcome.get("type") != "interrupt":
        return None
    interrupts = outcome.get("interrupts")
    if not isinstance(interrupts, Sequence) or isinstance(interrupts, (str, bytes)):
        return None
    for item in interrupts:
        if not isinstance(item, Mapping):
            continue
        for key in ("message", "reason", "value"):
            text = item.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
    return "The agent is waiting on a decision."


def to_agui_messages(
    messages: Sequence[Message],
    *,
    bot_user_id: str,
    names: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Blob history as AG-UI `Message[]`, oldest first.

    The listening bot's own rows become `assistant`; everyone else — people and other
    apps' bots alike — becomes `user` with a `name`. To the agent, another bot is simply
    another participant, which is the same thing it is to a person reading the channel.
    """
    out: list[dict[str, Any]] = []
    for message in messages:
        if message.deleted_at or message.kind == "system" or not message.body:
            continue
        mine = message.author_id == bot_user_id
        entry: dict[str, Any] = {
            "id": message.id,
            "role": "assistant" if mine else "user",
            "content": message.body,
        }
        if not mine:
            entry["name"] = names.get(message.author_id or "", "someone")
        out.append(entry)
    return out


def build_run_input(
    *,
    thread_id: str,
    run_id: str,
    messages: list[dict[str, Any]],
    channel_name: str,
    trigger_user: str,
) -> dict[str, Any]:
    """The POST body.

    camelCase throughout, and `state`, `tools`, `context` and `forwardedProps` are sent
    explicitly rather than omitted: the published Python model declares them required, so
    leaving them out is a 422 from every FastAPI-hosted agent — a failure that looks like
    the agent being broken.

    `tools` is empty by design. Offering frontend tools would mean Blob executing work on
    an agent's say-so; an app that wants to act already has a bot token and scopes.
    """
    return {
        "threadId": thread_id,
        "runId": run_id,
        "state": None,
        "messages": messages,
        "tools": [],
        "context": [
            {"description": "channel", "value": channel_name},
            {"description": "asked_by", "value": trigger_user},
        ],
        "forwardedProps": {},
    }
