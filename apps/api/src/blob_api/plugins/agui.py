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

import json
import logging
from collections.abc import Mapping, Sequence
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

#: Artifacts one run may publish into a work channel (ADR 0014), and how big each may be.
ARTIFACT_MAX_ITEMS = 10
ARTIFACT_MAX_BYTES = 200_000
ARTIFACT_KINDS = frozenset({"diff", "html", "markdown"})


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
        #: The question the agent stopped to ask, as one line; see `interrupt_prompt`.
        self.interrupt: str | None = None
        #: The raw `interrupts[]` from RUN_FINISHED, kept so a resume can name what it
        #: answers. None unless the run ended in an interrupt.
        self.interrupts: list[dict[str, Any]] | None = None
        #: Shared state, folded from STATE_SNAPSHOT and STATE_DELTA. Handed back as
        #: `state` when the run resumes, which is the whole reason to keep it.
        self.state: Any = None
        self.state_dropped = False
        #: `CUSTOM` events named `blob.artifact`: what the agent made, for a work channel.
        #: Kept here as data; the job decides whether there is a work channel to put
        #: them in. Anywhere else they are inert.
        self.artifacts: list[dict[str, str]] = []
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
            self.interrupts = interrupts_of(event)
            self.interrupt = interrupt_prompt(self.interrupts)
            return self.finish()

        if kind == "CUSTOM" and event.get("name") == "blob.artifact":
            self._take_artifact(event.get("value"))
            return []

        if kind == "STATE_SNAPSHOT":
            self._take_state(event.get("snapshot"))
            return []

        if kind == "STATE_DELTA":
            delta = event.get("delta")
            if self.state_dropped or not isinstance(delta, list):
                return []
            try:
                self._take_state(jsonpatch.apply(self.state, delta))
            except jsonpatch.PatchError:
                # Keep the last good state rather than half of a patch: a resume handed
                # a state the agent never had is worse than one handed no state.
                log.info("agui: a STATE_DELTA did not apply; keeping the last snapshot")
            return []

        # Everything else — RUN_STARTED, STEP_*, MESSAGES_SNAPSHOT, every REASONING_* and
        # THINKING_* event, TOOL_CALL_ARGS, TOOL_CALL_RESULT, CUSTOM — is deliberately
        # inert. Reasoning in particular is never posted: it is the agent's working-out,
        # not its answer.
        return []

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

    def _take_state(self, state: Any) -> None:
        """Keep the state if it fits; drop it for the rest of the run if it does not."""
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
    items = list(interrupts or [])
    prompt = interrupt_prompt(items) or "The agent is waiting on a decision."
    ids = [str(item["id"]) for item in items if isinstance(item.get("id"), str) and item["id"]]
    choices: list[Choice] = []
    for item in items:
        choices = _choices_of(item)
        if choices:
            break
    return Decision(
        prompt=prompt,
        choices=choices[:DECISION_MAX_CHOICES],
        interrupt_ids=ids or ["default"],
        expires_at=_earliest_expiry(items),
    )


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
    asked_by_agent: str | None = None,
    on_behalf_of: str | None = None,
    participants: Sequence[str] = (),
    state: Any = None,
    parent_run_id: str | None = None,
    resume: Sequence[Mapping[str, Any]] | None = None,
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

    `tools` is empty by design. Offering frontend tools would mean Blob executing work on
    an agent's say-so; an app that wants to act already has a bot token and scopes.

    The extra context items exist for a chain (ADR 0013): `asked_by_agent` names the agent
    whose reply mentioned this one, `on_behalf_of` the person whose authority the hop runs
    on, and `participants` the other agents in the room, so an agent can address one.
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
    body: dict[str, Any] = {
        "threadId": thread_id,
        "runId": run_id,
        "state": state,
        "messages": messages,
        "tools": [],
        "context": context,
        "forwardedProps": {},
    }
    if parent_run_id is not None:
        body["parentRunId"] = parent_run_id
    if resume is not None:
        body["resume"] = [dict(item) for item in resume]
    return body
