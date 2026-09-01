"""Thread summaries and human/agent task orchestration."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, forbidden, not_found
from ..lib.ids import new_id
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


@dataclass(slots=True)
class SummaryPayload:
    overview: str
    decisions: list[dict[str, str | None]]
    action_items: list[dict[str, str | None]]
    open_questions: list[str]
    participant_ids: list[str]
    message_count: int


def _normalize_text(raw: str) -> str:
    text_value = re.sub(r"\s+", " ", raw.strip())
    return text_value


def _message_sentences(messages: Iterable[Message]) -> list[tuple[str, str, list[str]]]:
    sentences: list[tuple[str, str, list[str]]] = []
    for message in messages:
        body = _normalize_text(message.body)
        if not body:
            continue
        parts = re.split(r"(?<=[.!?])\s+", body)
        for part in parts:
            cleaned = _normalize_text(part)
            if cleaned:
                sentences.append(
                    (
                        message.id,
                        cleaned,
                        list(message.mention_user_ids or []),
                    )
                )
    return sentences


def summarize_messages(messages: Sequence[Message]) -> SummaryPayload:
    if not messages:
        raise bad_request("There is nothing in that thread yet.", code="empty_thread")

    root_body = _normalize_text(messages[0].body)
    participant_ids = list(
        dict.fromkeys([message.author_id for message in messages if message.author_id])
    )
    sentences = _message_sentences(messages)

    decisions: list[dict[str, str | None]] = []
    action_items: list[dict[str, str | None]] = []
    open_questions: list[str] = []

    for message_id, sentence, mention_user_ids in sentences:
        if sentence.endswith("?") and len(open_questions) < 5:
            open_questions.append(sentence)
        if _DECISION_RE.search(sentence) and len(decisions) < 5:
            decisions.append({"text": sentence[:280], "messageId": message_id})
        if _ACTION_RE.search(sentence) and len(action_items) < 6:
            action_items.append(
                {
                    "text": sentence[:280],
                    "assigneeUserId": mention_user_ids[0] if mention_user_ids else None,
                    "sourceMessageId": message_id,
                }
            )

    if not decisions and root_body:
        decisions.append({"text": root_body[:280], "messageId": messages[0].id})

    if not action_items and len(messages) > 1:
        tail = messages[-1]
        tail_body = _normalize_text(tail.body)
        if tail_body:
            action_items.append(
                {
                    "text": tail_body[:280],
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


async def get_summary(session: AsyncSession, thread_root_id: str) -> ThreadSummary | None:
    row = (
        await session.execute(
            text("SELECT * FROM thread_summaries WHERE thread_root_id = :root_id"),
            {"root_id": thread_root_id},
        )
    ).fetchone()
    return to_thread_summary(row) if row else None


async def generate_summary(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str,
    created_by: str | None,
) -> ThreadSummary:
    messages = await message_service.thread(session, thread_root_id)
    payload = summarize_messages(messages)
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
                   'heuristic-v1', :overview, cast(:decisions AS jsonb),
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
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request("That isn't a time.") from None


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
