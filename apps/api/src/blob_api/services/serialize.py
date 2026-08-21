"""Database rows → API shapes. One place, so no route invents its own field names."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ..lib.storage import public_file_url
from ..schemas.base import iso, require_iso
from ..schemas.models import (
    AgentTask,
    Attachment,
    Channel,
    ChannelWithState,
    CurrentUser,
    FeedbackTicket,
    LinkPreview,
    Membership,
    Message,
    MessageTranslation,
    Reaction,
    ThreadSummary,
    ThreadSummaryActionItem,
    ThreadSummaryDecision,
    User,
    UserPrefs,
    Workspace,
)

#: The columns every user query selects. Kept in one place so the shape cannot drift.
USER_COLUMNS = """id, email, display_name, full_name, title, avatar_key, timezone, role,
  status_emoji, status_text, status_expires_at, prefs, deactivated_at, created_at, kind"""


def _prefs(raw: dict[str, Any] | None) -> UserPrefs:
    return UserPrefs.model_validate(raw or {})


def to_user(row: Any) -> User:
    # A status that has expired is simply not shown; no cleanup job needed.
    expires_at = row.status_expires_at
    expired = bool(expires_at and _as_datetime(expires_at) < datetime.now(UTC))
    return User(
        id=row.id,
        kind=getattr(row, "kind", None) or "human",
        display_name=row.display_name,
        full_name=row.full_name,
        title=row.title,
        avatar_url=public_file_url(row.avatar_key) if row.avatar_key else None,
        timezone=row.timezone,
        role=row.role,
        status_emoji=None if expired else row.status_emoji,
        status_text=None if expired else row.status_text,
        status_expires_at=None if expired else iso(expires_at),
        deactivated=row.deactivated_at is not None,
    )


def to_current_user(row: Any) -> CurrentUser:
    base = to_user(row)
    return CurrentUser(**base.model_dump(by_alias=False), email=row.email, prefs=_prefs(row.prefs))


def to_workspace(row: Any) -> Workspace:
    return Workspace(
        id=row.id, name=row.name, slug=row.slug, created_at=require_iso(row.created_at)
    )


def to_channel(row: Any) -> Channel:
    member_ids = getattr(row, "member_ids", None)
    return Channel(
        id=row.id,
        kind=row.kind,
        name=row.name,
        topic=row.topic,
        description=row.description,
        created_by=row.created_by,
        archived_at=iso(row.archived_at),
        last_message_id=row.last_message_id,
        created_at=require_iso(row.created_at),
        member_ids=list(member_ids) if member_ids else None,
    )


def to_channel_with_state(row: Any) -> ChannelWithState:
    base = to_channel(row)
    last_read = getattr(row, "last_read_message_id", None)
    joined_at = getattr(row, "joined_at", None)
    membership = (
        Membership(
            notify_level=getattr(row, "notify_level", None) or "mentions",
            is_starred=bool(getattr(row, "is_starred", False)),
            joined_at=require_iso(joined_at),
        )
        if joined_at
        else None
    )
    # UUIDv7 sorts chronologically, so this comparison *is* the unread check.
    has_unread = bool(row.last_message_id and (not last_read or row.last_message_id > last_read))
    return ChannelWithState(
        **base.model_dump(by_alias=False),
        membership=membership,
        has_unread=has_unread,
        mention_count=getattr(row, "mention_count", None) or 0,
        last_read_message_id=last_read,
    )


def to_attachment(raw: dict[str, Any]) -> Attachment:
    return Attachment(
        id=raw["id"],
        filename=raw["filename"],
        mime=raw["mime"],
        size_bytes=int(raw["size_bytes"]),
        width=raw.get("width"),
        height=raw.get("height"),
        url=public_file_url(raw["object_key"]),
        thumb_url=public_file_url(raw["thumb_key"]) if raw.get("thumb_key") else None,
    )


def to_message(row: Any) -> Message:
    deleted = row.deleted_at is not None
    reactions = [
        Reaction(emoji=item["emoji"], user_ids=item.get("user_ids") or [])
        for item in (getattr(row, "reactions", None) or [])
        if item and item.get("emoji")
    ]
    attachments = (
        []
        if deleted
        else [to_attachment(item) for item in (getattr(row, "attachments", None) or []) if item]
    )
    preview = None if deleted else getattr(row, "link_preview", None)
    # Deleting a message must take its buttons with it, or an interaction could still be
    # sent against content that is gone.
    blocks = None if deleted else getattr(row, "blocks", None)

    return Message(
        id=row.id,
        channel_id=row.channel_id,
        author_id=row.author_id,
        kind=row.kind,
        # A deleted message keeps its row (threads hang off it) but loses its content.
        body="" if deleted else row.body,
        thread_root_id=row.thread_root_id,
        also_in_channel=row.also_in_channel,
        reply_count=row.reply_count,
        reply_user_ids=list(row.reply_user_ids or []),
        last_reply_at=iso(row.last_reply_at),
        mention_user_ids=list(row.mention_user_ids or []),
        mentions_everyone=row.mentions_everyone,
        client_msg_id=row.client_msg_id,
        edited_at=iso(row.edited_at),
        deleted_at=iso(row.deleted_at),
        pinned_at=iso(row.pinned_at),
        created_at=require_iso(row.created_at),
        reactions=reactions,
        attachments=attachments,
        blocks=blocks or None,
        plugin_id=getattr(row, "plugin_id", None),
        link_preview=LinkPreview.model_validate(preview) if preview else None,
    )


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def to_thread_summary(row: Any) -> ThreadSummary:
    return ThreadSummary(
        id=row.id,
        channel_id=row.channel_id,
        thread_root_id=row.thread_root_id,
        created_by=row.created_by,
        provider=row.provider,
        overview=row.overview,
        decisions=[
            ThreadSummaryDecision.model_validate(item)
            for item in (row.decisions or [])
            if item is not None
        ],
        action_items=[
            ThreadSummaryActionItem.model_validate(item)
            for item in (row.action_items or [])
            if item is not None
        ],
        open_questions=list(row.open_questions or []),
        participant_ids=list(row.participant_ids or []),
        message_count=row.message_count,
        created_at=require_iso(row.created_at),
        updated_at=require_iso(row.updated_at),
    )


def to_agent_task(row: Any) -> AgentTask:
    return AgentTask(
        id=row.id,
        channel_id=row.channel_id,
        thread_root_id=row.thread_root_id,
        created_by=row.created_by,
        assignee_user_id=row.assignee_user_id,
        assignee_kind=getattr(row, "assignee_kind", None),
        summary_id=row.summary_id,
        title=row.title,
        instructions=row.instructions,
        status=row.status,
        priority=row.priority,
        due_at=iso(row.due_at),
        completed_at=iso(row.completed_at),
        outcome=row.outcome,
        external_ref=row.external_ref or {},
        created_at=require_iso(row.created_at),
        updated_at=require_iso(row.updated_at),
    )


def to_message_translation(row: Any, *, cached: bool = False) -> MessageTranslation:
    return MessageTranslation(
        id=row.id,
        message_id=row.message_id,
        requested_by=row.requested_by,
        provider=row.provider,
        source_language=row.source_language,
        target_language=row.target_language,
        translated_text=row.translated_text,
        cached=cached,
        created_at=require_iso(row.created_at),
        updated_at=require_iso(row.updated_at),
    )


#: SQL fragment that aggregates reactions and attachments onto a message row.
def message_event(name: str, message: Message) -> dict[str, Any]:
    """The socket envelope carrying a message. Shared so every sender emits one shape."""
    return {"t": name, "message": message.model_dump(by_alias=True)}


MESSAGE_SELECT = """
  m.*,
  COALESCE((
    SELECT json_agg(json_build_object('emoji', r.emoji, 'user_ids', r.user_ids)
                    ORDER BY r.first_at)
      FROM (
        SELECT emoji,
               array_agg(user_id ORDER BY created_at) AS user_ids,
               min(created_at) AS first_at
          FROM reactions
         WHERE message_id = m.id
         GROUP BY emoji
      ) r
  ), '[]'::json) AS reactions,
  COALESCE((
    SELECT json_agg(json_build_object(
             'id', a.id, 'object_key', a.object_key, 'thumb_key', a.thumb_key,
             'filename', a.filename, 'mime', a.mime, 'size_bytes', a.size_bytes,
             'width', a.width, 'height', a.height) ORDER BY a.created_at)
      FROM attachments a
     WHERE a.message_id = m.id
  ), '[]'::json) AS attachments
"""


def to_feedback_ticket(row: Any) -> FeedbackTicket:
    return FeedbackTicket(
        id=row.id,
        kind=row.kind,
        title=row.title,
        body=row.body,
        status=row.status,
        reporter_id=row.reporter_id,
        environment={str(k): str(v) for k, v in (row.environment or {}).items()},
        console_log=row.console_log or "",
        # The snapshot is fetched by its own endpoint, so the ticket only says whether
        # one exists — a list of tickets must not drag megabytes of markup with it.
        has_snapshot=bool(row.snapshot_key),
        created_at=require_iso(row.created_at),
        resolved_at=iso(row.resolved_at),
        resolved_by=row.resolved_by,
    )
