"""Thread summaries and human/agent task orchestration.

A summary has two providers and says which one wrote it. `heuristic-v1` is a keyword
scan — sentences that say *decided* or *please*, sentences that end in a question mark —
and it runs when no model is configured, because a self-hosted Blob with no API key is a
reasonable deployment and the index it produces is still worth having. `llm:<model>` is
the model, asked for JSON against a numbered transcript so that every decision, action
item and open question can point back at the message it rests on; ids are resolved here
from those numbers and never asked of the model.

The model call never runs inside a transaction (see `routers/messages.py:translate_message`
for the same split): read the thread, call the model with nothing held, then store in a
short transaction. A model that fails is a typed 502, not a keyword scan in disguise —
the person pressed Refresh expecting the model, and the previous summary stays.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib import llm
from ..lib.errors import AppError, bad_request, forbidden, not_found
from ..lib.ids import new_id
from ..lib.times import parse_client_time
from ..schemas.models import AgentTask, Message, ThreadSummary
from . import channels as channel_service
from . import messages as message_service
from .serialize import to_agent_task, to_thread_summary

_DECISION_RE = re.compile(
    r"\b(decided|decision|agreed|ship|shipping|approved|resolved|final|we will)\b",
    re.IGNORECASE,
)
_ACTION_RE = re.compile(
    r"\b(todo|follow up|please|need to|needs to|will own|owner:|action item|next step)\b",
    re.IGNORECASE,
)

#: What the keyword scan writes into `thread_summaries.provider`.
HEURISTIC_PROVIDER = "heuristic-v1"

#: Caps shared by both providers, so a summary is a summary whoever wrote it.
MAX_DECISIONS = 5
MAX_ACTION_ITEMS = 6
MAX_OPEN_QUESTIONS = 5
TEXT_LIMIT = 280

#: What the model is shown. A thread longer than this is the root plus the most recent
#: messages with a note about what was skipped; a single pasted log is clipped; the whole
#: transcript is bounded in characters (~6-8k tokens) because input is what costs.
MAX_MESSAGES = 120
MAX_MESSAGE_CHARS = 600
MAX_TRANSCRIPT_CHARS = 24_000
#: A cap, not spend. On current Anthropic models it covers the model's *thinking* as well as
#: its text, and a full summary of a busy thread is 600-1200 tokens of JSON on its own —
#: size it for both, or long threads answer "ran out of room" exactly when they matter.
MAX_OUTPUT_TOKENS = 4096
#: A person is waiting in a panel. Longer than this and the honest answer is "try again".
TIMEOUT_SEC = 45.0

SUMMARY_SYSTEM = (
    "You summarise one team-chat thread for somebody who has not read it. Answer with a "
    "single JSON object and nothing else, shaped exactly like this: "
    '{"overview": string, "decisions": [{"text": string, "sources": [int]}], '
    '"action_items": [{"text": string, "owner": string | null, "sources": [int]}], '
    '"open_questions": [{"text": string, "sources": [int]}]}. '
    "The transcript numbers every message like [3]; sources lists the numbers of the "
    "messages a line rests on, and every decision, action item and open question needs at "
    "least one. overview: two to four plain sentences saying what the thread is about and "
    "where it stands. decisions: things that were actually settled, not proposed. "
    "action_items: who is going to do what; owner is the speaker's name exactly as written "
    "in the transcript, or null. open_questions: questions nobody answered. Keep @names "
    "verbatim, write in the thread's language, never invent facts, and use empty lists "
    "when there is nothing to list. At most 5 decisions, 6 action items and 5 open questions."
)

_SOURCED = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "text": {"type": "string"},
        "sources": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["text", "sources"],
}

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "overview": {"type": "string"},
        "decisions": {"type": "array", "items": _SOURCED},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "text": {"type": "string"},
                    "owner": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "sources": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["text", "owner", "sources"],
            },
        },
        "open_questions": {"type": "array", "items": _SOURCED},
    },
    "required": ["overview", "decisions", "action_items", "open_questions"],
}


@dataclass(slots=True)
class SummaryPayload:
    overview: str
    decisions: list[dict[str, str | None]]
    action_items: list[dict[str, str | None]]
    open_questions: list[dict[str, str | None]]
    participant_ids: list[str]
    message_count: int


class _ModelItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = ""
    owner: str | None = None
    sources: list[int] = Field(default_factory=list)


class _ModelSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    overview: str = ""
    decisions: list[_ModelItem] = Field(default_factory=list)
    action_items: list[_ModelItem] = Field(default_factory=list)
    open_questions: list[_ModelItem] = Field(default_factory=list)


def model_provider() -> str:
    return f"llm:{llm.model_name()}"


def _normalize_text(raw: str) -> str:
    text_value = re.sub(r"\s+", " ", raw.strip())
    return text_value


def _clip(raw: str) -> str:
    return _normalize_text(raw)[:TEXT_LIMIT]


def _participants(messages: Iterable[Message]) -> list[str]:
    return list(dict.fromkeys([message.author_id for message in messages if message.author_id]))


# --- the keyword scan ------------------------------------------------------------------


def _message_sentences(messages: Iterable[Message]) -> list[tuple[Message, str]]:
    sentences: list[tuple[Message, str]] = []
    for message in messages:
        body = _normalize_text(message.body)
        if not body:
            continue
        parts = re.split(r"(?<=[.!?])\s+", body)
        for part in parts:
            cleaned = _normalize_text(part)
            if cleaned:
                sentences.append((message, cleaned))
    return sentences


def summarize_messages(messages: Sequence[Message]) -> SummaryPayload:
    """The keyword scan. Never empty-handed: a thread with nothing that matches still
    gets its root as the decision and its last reply as the action item."""
    if not messages:
        raise bad_request("There is nothing in that thread yet.", code="empty_thread")

    root_body = _normalize_text(messages[0].body)
    participant_ids = _participants(messages)
    sentences = _message_sentences(messages)

    decisions: list[dict[str, str | None]] = []
    action_items: list[dict[str, str | None]] = []
    open_questions: list[dict[str, str | None]] = []

    for message, sentence in sentences:
        mention_user_ids = list(message.mention_user_ids or [])
        if sentence.endswith("?") and len(open_questions) < MAX_OPEN_QUESTIONS:
            open_questions.append(
                {
                    "text": sentence[:TEXT_LIMIT],
                    "messageId": message.id,
                    "askedByUserId": message.author_id,
                }
            )
        if _DECISION_RE.search(sentence) and len(decisions) < MAX_DECISIONS:
            decisions.append({"text": sentence[:TEXT_LIMIT], "messageId": message.id})
        if _ACTION_RE.search(sentence) and len(action_items) < MAX_ACTION_ITEMS:
            action_items.append(
                {
                    "text": sentence[:TEXT_LIMIT],
                    "assigneeUserId": mention_user_ids[0] if mention_user_ids else None,
                    "sourceMessageId": message.id,
                }
            )

    if not decisions and root_body:
        decisions.append({"text": root_body[:TEXT_LIMIT], "messageId": messages[0].id})

    if not action_items and len(messages) > 1:
        tail = messages[-1]
        tail_body = _normalize_text(tail.body)
        if tail_body:
            action_items.append(
                {
                    "text": tail_body[:TEXT_LIMIT],
                    "assigneeUserId": None,
                    "sourceMessageId": tail.id,
                }
            )

    participants_text = (
        "No participants"
        if not participant_ids
        else f"{len(participant_ids)} participant{'s' if len(participant_ids) != 1 else ''}"
    )
    root_excerpt = root_body[:320] if root_body else "Thread activity without text content."
    overview = (
        f"{root_excerpt} "
        f"This thread contains {len(messages)} message{'s' if len(messages) != 1 else ''} from "
        f"{participants_text.lower()}."
    )

    return SummaryPayload(
        overview=overview,
        decisions=decisions,
        action_items=action_items,
        open_questions=open_questions,
        participant_ids=participant_ids,
        message_count=len(messages),
    )


# --- the model -------------------------------------------------------------------------


def transcript(
    messages: Sequence[Message], names: Mapping[str, str]
) -> tuple[list[tuple[int, Message]], str]:
    """Number the thread for the model, bounded on every axis.

    Returns the (number, message) pairs the text names, so a `sources` entry maps back to
    a real id. When the thread is long the root and the most recent messages survive and
    the middle is replaced by one line saying how much was skipped; numbers are assigned
    before anything is dropped, so they stay stable whatever the model cites.
    """
    usable = [
        message
        for message in messages
        if message.body.strip() and message.kind != "system" and message.deleted_at is None
    ]
    omitted = 0
    if len(usable) > MAX_MESSAGES:
        omitted = len(usable) - MAX_MESSAGES
        usable = [usable[0], *usable[-(MAX_MESSAGES - 1) :]]
    numbered = list(enumerate(usable, start=1))

    def line(number: int, message: Message) -> str:
        body = _normalize_text(message.body)
        if len(body) > MAX_MESSAGE_CHARS:
            body = body[: MAX_MESSAGE_CHARS - 1] + "…"
        who = names.get(message.author_id or "", "someone")
        return f"[{number}] {who}: {body}"

    lines = [line(number, message) for number, message in numbered]
    while sum(len(entry) + 1 for entry in lines) > MAX_TRANSCRIPT_CHARS and len(lines) > 2:
        middle = len(lines) // 2
        del lines[middle]
        del numbered[middle]
        omitted += 1
    if omitted:
        plural = "s" if omitted != 1 else ""
        lines.insert(1, f"… {omitted} message{plural} from the middle of the thread omitted …")
    return numbered, "\n".join(lines)


async def model_summary(messages: Sequence[Message], *, names: Mapping[str, str]) -> SummaryPayload:
    """Ask the model, then turn its numbers into ids. Raises `llm.LlmError` when it cannot
    be trusted: no reply, no JSON, no overview, out of room, declined."""
    numbered, body = transcript(messages, names)
    if not numbered:
        raise bad_request("There is nothing in that thread yet.", code="empty_thread")

    raw = await llm.complete(
        system=SUMMARY_SYSTEM,
        turns=[llm.Turn(role="user", content=f"Thread ({len(numbered)} messages shown):\n{body}")],
        max_tokens=MAX_OUTPUT_TOKENS,
        timeout_sec=TIMEOUT_SEC,
        json_schema=SUMMARY_SCHEMA,
    )
    try:
        parsed = _ModelSummary.model_validate(llm.extract_json(raw))
    except ValidationError as error:
        raise llm.LlmError("the model did not answer in the expected shape") from error

    overview = _normalize_text(parsed.overview)[:1000]
    if not overview:
        raise llm.LlmError("the model did not answer in the expected shape")

    by_number = dict(numbered)
    # Display names are unique among active users, but a deactivated speaker can share one:
    # an owner that could be two people is nobody rather than the wrong one.
    name_counts = Counter(name.casefold() for name in names.values())
    ids_by_name = {
        name.casefold(): user_id
        for user_id, name in names.items()
        if name_counts[name.casefold()] == 1
    }

    def source_of(item: _ModelItem) -> Message | None:
        for number in item.sources:
            found = by_number.get(number)
            if found is not None:
                return found
        return None

    def owner_of(owner: str | None) -> str | None:
        if not owner:
            return None
        return ids_by_name.get(owner.strip().lstrip("@").casefold())

    # A model that cites at all is held to citing correctly: an uncited line beside cited
    # ones, or a line citing a number that is not there, is the one most likely invented.
    # A model that never cites (a compatible server that ignored the schema) keeps its
    # lines, uncited and honest. "Cites at all" means it *tried* — resolved or not.
    groups = (parsed.decisions, parsed.action_items, parsed.open_questions)
    cited_any = any(item.sources for group in groups for item in group)

    def kept(items: Sequence[_ModelItem], limit: int) -> list[tuple[_ModelItem, Message | None]]:
        out: list[tuple[_ModelItem, Message | None]] = []
        for item in items:
            if not item.text.strip():
                continue
            source = source_of(item)
            if cited_any and source is None:
                continue
            out.append((item, source))
            if len(out) == limit:
                break
        return out

    decisions: list[dict[str, str | None]] = [
        {"text": _clip(item.text), "messageId": source.id if source else None}
        for item, source in kept(parsed.decisions, MAX_DECISIONS)
    ]
    action_items: list[dict[str, str | None]] = [
        {
            "text": _clip(item.text),
            "assigneeUserId": owner_of(item.owner),
            "sourceMessageId": source.id if source else None,
        }
        for item, source in kept(parsed.action_items, MAX_ACTION_ITEMS)
    ]
    open_questions: list[dict[str, str | None]] = [
        {
            "text": _clip(item.text),
            "messageId": source.id if source else None,
            "askedByUserId": source.author_id if source else None,
        }
        for item, source in kept(parsed.open_questions, MAX_OPEN_QUESTIONS)
    ]
    return SummaryPayload(
        overview=overview,
        decisions=decisions,
        action_items=action_items,
        open_questions=open_questions,
        participant_ids=_participants(messages),
        message_count=len(messages),
    )


# --- reading, choosing, storing ---------------------------------------------------------


async def read_thread(
    session: AsyncSession, thread_root_id: str
) -> tuple[list[Message], dict[str, str]]:
    """The thread and its speakers' names — everything a summary needs, read once."""
    messages = await message_service.thread(session, thread_root_id)
    if not messages:
        raise bad_request("There is nothing in that thread yet.", code="empty_thread")
    ids = _participants(messages)
    names: dict[str, str] = {}
    if ids:
        rows = (
            await session.execute(
                text("SELECT id, display_name FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": ids},
            )
        ).fetchall()
        names = {str(row.id): row.display_name for row in rows}
    return messages, names


async def build_summary(
    messages: Sequence[Message], *, names: Mapping[str, str]
) -> tuple[SummaryPayload, str]:
    """The summary and who wrote it. Call with no session held: this is the model call."""
    if not llm.configured():
        return summarize_messages(messages), HEURISTIC_PROVIDER
    numbered, _ = transcript(messages, names)
    if not numbered:
        # Attachments and system rows only: nothing to show a model. The scan copes.
        return summarize_messages(messages), HEURISTIC_PROVIDER
    try:
        return await model_summary(messages, names=names), model_provider()
    except llm.LlmError as error:
        raise AppError(502, "llm_failed", f"The model could not summarise: {error}") from error


async def get_summary(session: AsyncSession, thread_root_id: str) -> ThreadSummary | None:
    row = (
        await session.execute(
            text("SELECT * FROM thread_summaries WHERE thread_root_id = :root_id"),
            {"root_id": thread_root_id},
        )
    ).fetchone()
    return to_thread_summary(row) if row else None


async def store_summary(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str,
    created_by: str | None,
    provider: str,
    payload: SummaryPayload,
) -> ThreadSummary:
    """One row per thread; a refresh keeps the row's id, which tasks point at."""
    summary_id = new_id()
    row = (
        await session.execute(
            text(
                """
                INSERT INTO thread_summaries
                  (id, workspace_id, channel_id, thread_root_id, created_by, provider, overview,
                   decisions, action_items, open_questions, participant_ids, message_count)
                VALUES
                  (:id, :workspace_id, :channel_id, :thread_root_id, cast(:created_by AS uuid),
                   :provider, :overview, cast(:decisions AS jsonb),
                   cast(:action_items AS jsonb), cast(:open_questions AS jsonb),
                   cast(:participant_ids AS uuid[]), :message_count)
                ON CONFLICT (thread_root_id) DO UPDATE
                  SET created_by = EXCLUDED.created_by,
                      provider = EXCLUDED.provider,
                      overview = EXCLUDED.overview,
                      decisions = EXCLUDED.decisions,
                      action_items = EXCLUDED.action_items,
                      open_questions = EXCLUDED.open_questions,
                      participant_ids = EXCLUDED.participant_ids,
                      message_count = EXCLUDED.message_count,
                      updated_at = now()
                RETURNING *
                """
            ),
            {
                "id": summary_id,
                "workspace_id": workspace_id,
                "channel_id": channel_id,
                "thread_root_id": thread_root_id,
                "created_by": created_by,
                "provider": provider,
                "overview": payload.overview,
                "decisions": json.dumps(payload.decisions),
                "action_items": json.dumps(payload.action_items),
                "open_questions": json.dumps(payload.open_questions),
                "participant_ids": payload.participant_ids,
                "message_count": payload.message_count,
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not update that summary.")
    return to_thread_summary(row)


async def list_tasks_for_thread(session: AsyncSession, thread_root_id: str) -> list[AgentTask]:
    rows = (
        await session.execute(
            text(
                """
                SELECT t.*,
                       u.kind AS assignee_kind
                  FROM agent_tasks t
                  LEFT JOIN users u ON u.id = t.assignee_user_id
                 WHERE t.thread_root_id = :root_id
                 ORDER BY t.updated_at DESC, t.id DESC
                """
            ),
            {"root_id": thread_root_id},
        )
    ).fetchall()
    return [to_agent_task(row) for row in rows]


def parse_due_at(raw: str | None) -> datetime | None:
    """A task's due date, as something asyncpg will bind.

    It arrived as a `str` and went straight into `cast(:due_at AS timestamptz)`. asyncpg
    reads that cast as the *parameter's* own type and refuses a string, so every task
    with a due date was a 500 — from any client, since the field existed. The same fault
    as `status_expires_at`, in a second place.

    Refused with the sentence `later` and `schedule` already use, because it is the same
    mistake and the client shows whatever we say.
    """
    if raw is None:
        return None
    return parse_client_time(raw)


async def create_task(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    created_by: str | None,
    assignee_user_id: str | None,
    title: str,
    instructions: str,
    priority: str,
    due_at: str | None,
    summary_id: str | None,
    external_ref: dict[str, str],
) -> AgentTask:
    if assignee_user_id:
        assignee = (
            await session.execute(
                text(
                    """
                    SELECT id, workspace_id, deactivated_at
                      FROM users
                     WHERE id = :id
                    """
                ),
                {"id": assignee_user_id},
            )
        ).fetchone()
        if assignee is None or assignee.workspace_id != workspace_id:
            raise not_found("That assignee no longer exists.")
        if assignee.deactivated_at is not None:
            raise forbidden("You cannot assign work to a deactivated user.")
        await channel_service.assert_channel_access(session, assignee_user_id, channel_id)

    row = (
        await session.execute(
            text(
                """
                INSERT INTO agent_tasks
                  (id, workspace_id, channel_id, thread_root_id, created_by, assignee_user_id,
                   summary_id, title, instructions, status, priority, due_at, external_ref)
                VALUES
                  (:id, :workspace_id, :channel_id, cast(:thread_root_id AS uuid),
                   cast(:created_by AS uuid), cast(:assignee_user_id AS uuid),
                   cast(:summary_id AS uuid), :title, :instructions, 'todo', :priority,
                   cast(:due_at AS timestamptz), cast(:external_ref AS jsonb))
                RETURNING *
                """
            ),
            {
                "id": new_id(),
                "workspace_id": workspace_id,
                "channel_id": channel_id,
                "thread_root_id": thread_root_id,
                "created_by": created_by,
                "assignee_user_id": assignee_user_id,
                "summary_id": summary_id,
                "title": title.strip(),
                "instructions": instructions.strip(),
                "priority": priority,
                "due_at": parse_due_at(due_at),
                "external_ref": json.dumps(external_ref),
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not create that task.")
    enriched = (
        await session.execute(
            text(
                """
                SELECT t.*, u.kind AS assignee_kind
                  FROM agent_tasks t
                  LEFT JOIN users u ON u.id = t.assignee_user_id
                 WHERE t.id = :id
                """
            ),
            {"id": row.id},
        )
    ).fetchone()
    if enriched is None:
        raise bad_request("Could not load that task.")
    return to_agent_task(enriched)


async def get_task(session: AsyncSession, task_id: str) -> AgentTask:
    row = (
        await session.execute(
            text(
                """
                SELECT t.*, u.kind AS assignee_kind
                  FROM agent_tasks t
                  LEFT JOIN users u ON u.id = t.assignee_user_id
                 WHERE t.id = :id
                """
            ),
            {"id": task_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("That task no longer exists.")
    return to_agent_task(row)


def _completed_at_for(status: str | None, previous: AgentTask) -> datetime | None:
    if status == "done":
        return datetime.now(UTC)
    if status and status != previous.status:
        return None
    if previous.completed_at is None:
        return None
    return datetime.fromisoformat(previous.completed_at.replace("Z", "+00:00"))


async def update_task(
    session: AsyncSession,
    *,
    task_id: str,
    workspace_id: str,
    assignee_user_id: str | None,
    status: str | None,
    priority: str | None,
    due_at: str | None,
    outcome: str | None,
    instructions: str | None,
) -> AgentTask:
    existing = await get_task(session, task_id)
    completed_at = _completed_at_for(status, existing)
    if assignee_user_id:
        assignee = (
            await session.execute(
                text("SELECT id, workspace_id, deactivated_at FROM users WHERE id = :id"),
                {"id": assignee_user_id},
            )
        ).fetchone()
        if assignee is None or assignee.workspace_id != workspace_id:
            raise not_found("That assignee no longer exists.")
        if assignee.deactivated_at is not None:
            raise forbidden("You cannot assign work to a deactivated user.")
        await channel_service.assert_channel_access(session, assignee_user_id, existing.channel_id)

    row = (
        await session.execute(
            text(
                """
                UPDATE agent_tasks
                   SET assignee_user_id = CASE
                         WHEN :assignee_user_id_set THEN cast(:assignee_user_id AS uuid)
                         ELSE assignee_user_id
                       END,
                       status = COALESCE(:status, status),
                       priority = COALESCE(:priority, priority),
                       due_at = CASE
                         WHEN :due_at_set THEN cast(:due_at AS timestamptz)
                         ELSE due_at
                       END,
                       outcome = CASE WHEN :outcome_set THEN :outcome ELSE outcome END,
                       instructions = CASE
                         WHEN :instructions_set THEN :instructions
                         ELSE instructions
                       END,
                       completed_at = CASE
                         WHEN :completed_at_set THEN cast(:completed_at AS timestamptz)
                         ELSE completed_at
                       END,
                       updated_at = now()
                 WHERE id = :id
                 RETURNING *
                """
            ),
            {
                "id": task_id,
                "assignee_user_id_set": assignee_user_id is not None,
                "assignee_user_id": assignee_user_id,
                "status": status,
                "priority": priority,
                "due_at_set": due_at is not None,
                "due_at": parse_due_at(due_at),
                "outcome_set": outcome is not None,
                "outcome": outcome.strip() if outcome is not None else None,
                "instructions_set": instructions is not None,
                "instructions": instructions.strip() if instructions is not None else None,
                "completed_at_set": status is not None,
                "completed_at": completed_at,
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not update that task.")
    enriched = (
        await session.execute(
            text(
                """
                SELECT t.*, u.kind AS assignee_kind
                  FROM agent_tasks t
                  LEFT JOIN users u ON u.id = t.assignee_user_id
                 WHERE t.id = :id
                """
            ),
            {"id": row.id},
        )
    ).fetchone()
    if enriched is None:
        raise bad_request("Could not load that task.")
    return to_agent_task(enriched)
