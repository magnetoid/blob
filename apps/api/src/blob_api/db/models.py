"""SQLAlchemy models mirroring the existing schema exactly.

Fidelity notes, because these are the parts Alembic autogenerate gets wrong if the
model does not spell them out:
  * `messages.search_tsv` is a STORED generated column — `Computed(..., persisted=True)`.
  * Five indexes are partial — `postgresql_where=`.
  * Two are GIN — `postgresql_using="gin"`.
Without these, the first `--autogenerate` proposes dropping them.

UUID columns use `as_uuid=False` so ids round-trip as strings, matching the TypeScript
server and keeping the UUIDv7 string comparisons that unread state depends on.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, INET, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

UUIDStr = UUID(as_uuid=False)
Timestamp = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


def _now() -> Any:
    return text("now()")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("workspace_id", "email"),
        CheckConstraint("role IN ('member', 'admin', 'owner')", name="users_role_check"),
        # Mention resolution looks users up by lowercased display name. Partial, so a
        # deactivated user does not hold their name hostage.
        Index(
            "users_display_name_uniq",
            "workspace_id",
            func.lower(text("display_name")),
            unique=True,
            postgresql_where=text("deactivated_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    avatar_key: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'UTC'"))
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'member'"))
    status_emoji: Mapped[str | None] = mapped_column(Text)
    status_text: Mapped[str | None] = mapped_column(Text)
    status_expires_at: Mapped[Any | None] = mapped_column(Timestamp)
    prefs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    deactivated_at: Mapped[Any | None] = mapped_column(Timestamp)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("sessions_user", "user_id"),
        Index("sessions_expiry", "expires_at"),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    last_seen_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    expires_at: Mapped[Any] = mapped_column(Timestamp, nullable=False)


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (
        CheckConstraint("role IN ('member', 'admin')", name="invites_role_check"),
        Index("invites_workspace", "workspace_id", text("id DESC")),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str | None] = mapped_column(CITEXT)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_by: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[Any] = mapped_column(Timestamp, nullable=False)
    accepted_at: Mapped[Any | None] = mapped_column(Timestamp)
    accepted_by: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    # An invite carries the role it grants, so admins can invite admins.
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'member'"))
    revoked_at: Mapped[Any | None] = mapped_column(Timestamp)


class AuditEvent(Base):
    """Append-only record of who did what. Written by every admin mutation."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("audit_events_recent", "workspace_id", text("id DESC")),
        Index("audit_events_actor", "actor_id", text("id DESC")),
        Index("audit_events_action", "workspace_id", "action"),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str | None] = mapped_column(Text)
    target_id: Mapped[str | None] = mapped_column(UUIDStr)
    # `metadata` is reserved on DeclarativeBase, so the attribute is renamed.
    meta: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class WorkspaceSettings(Base):
    __tablename__ = "workspace_settings"

    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    updated_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    updated_by: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expires_at: Mapped[Any] = mapped_column(Timestamp, nullable=False)
    used_at: Mapped[Any | None] = mapped_column(Timestamp)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('public', 'private', 'dm', 'group_dm')", name="channels_kind_check"
        ),
        Index(
            "channels_name_uniq",
            "workspace_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("kind IN ('public', 'private')"),
        ),
        Index(
            "channels_dm_uniq",
            "workspace_id",
            "dm_key",
            unique=True,
            postgresql_where=text("dm_key IS NOT NULL"),
        ),
        Index("channels_workspace", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )
    archived_at: Mapped[Any | None] = mapped_column(Timestamp)
    # Denormalized so "has unread?" is one UUIDv7 comparison, never a COUNT.
    last_message_id: Mapped[str | None] = mapped_column(UUIDStr)
    # Sorted member-id digest; makes DM creation idempotent.
    dm_key: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class ChannelMember(Base):
    __tablename__ = "channel_members"
    __table_args__ = (
        PrimaryKeyConstraint("channel_id", "user_id"),
        # Name matches what Postgres generated for the inline CHECK in 001_init.sql.
        CheckConstraint(
            "notify_level IN ('all', 'mentions', 'none')",
            name="channel_members_notify_level_check",
        ),
        Index("channel_members_user", "user_id"),
    )

    channel_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    joined_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    notify_level: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'mentions'")
    )
    is_starred: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("kind IN ('user', 'system', 'bot')", name="messages_kind_check"),
        # The workhorse: a channel's timeline, newest first.
        Index("messages_channel_id_desc", "channel_id", text("id DESC")),
        Index(
            "messages_thread",
            "thread_root_id",
            "id",
            postgresql_where=text("thread_root_id IS NOT NULL"),
        ),
        # Idempotent sends: retrying the same client_msg_id is a no-op.
        Index(
            "messages_client_idem", "channel_id", "author_id", "client_msg_id", unique=True
        ),
        Index("messages_search", "search_tsv", postgresql_using="gin"),
        Index("messages_mentions", "mention_user_ids", postgresql_using="gin"),
        Index(
            "messages_pinned",
            "channel_id",
            text("pinned_at DESC"),
            postgresql_where=text("pinned_at IS NOT NULL"),
        ),
        Index("messages_author", "author_id", text("id DESC")),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    channel_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'user'"))
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    thread_root_id: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("messages.id", ondelete="CASCADE")
    )
    also_in_channel: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reply_user_ids: Mapped[list[str]] = mapped_column(
        ARRAY(UUIDStr), nullable=False, server_default=text("'{}'")
    )
    last_reply_at: Mapped[Any | None] = mapped_column(Timestamp)
    mention_user_ids: Mapped[list[str]] = mapped_column(
        ARRAY(UUIDStr), nullable=False, server_default=text("'{}'")
    )
    mentions_everyone: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    client_msg_id: Mapped[str] = mapped_column(Text, nullable=False)
    edited_at: Mapped[Any | None] = mapped_column(Timestamp)
    deleted_at: Mapped[Any | None] = mapped_column(Timestamp)
    pinned_at: Mapped[Any | None] = mapped_column(Timestamp)
    pinned_by: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())
    search_tsv: Mapped[Any] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', body)", persisted=True)
    )
    # Added by 002; link previews live beside the message so an edit cannot forge one.
    link_preview: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class Reaction(Base):
    __tablename__ = "reactions"
    __table_args__ = (
        PrimaryKeyConstraint("message_id", "emoji", "user_id"),
        Index("reactions_message", "message_id"),
    )

    message_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    emoji: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        Index("attachments_message", "message_id"),
        # Sweeper target: uploads never bound to a message.
        Index("attachments_orphans", "created_at", postgresql_where=text("message_id IS NULL")),
    )

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str | None] = mapped_column(
        UUIDStr, ForeignKey("messages.id", ondelete="CASCADE")
    )
    uploader_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    thumb_key: Mapped[str | None] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    mime: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    uploaded_at: Mapped[Any | None] = mapped_column(Timestamp)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class CustomEmoji(Base):
    __tablename__ = "custom_emoji"
    __table_args__ = (PrimaryKeyConstraint("workspace_id", "name"),)

    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class ReadState(Base):
    __tablename__ = "read_states"
    __table_args__ = (PrimaryKeyConstraint("user_id", "channel_id"),)

    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    last_read_message_id: Mapped[str | None] = mapped_column(UUIDStr)
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    updated_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class ThreadSubscription(Base):
    __tablename__ = "thread_subscriptions"
    __table_args__ = (
        PrimaryKeyConstraint("user_id", "thread_root_id"),
        Index("thread_subs_root", "thread_root_id"),
    )

    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    thread_root_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    last_read_reply_id: Mapped[str | None] = mapped_column(UUIDStr)
    muted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (Index("push_subs_user", "user_id"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    channel_id: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_by: Mapped[str] = mapped_column(
        UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    last_used_at: Mapped[Any | None] = mapped_column(Timestamp)
    created_at: Mapped[Any] = mapped_column(Timestamp, nullable=False, server_default=_now())


__all__ = [
    "Attachment",
    "AuditEvent",
    "Base",
    "Channel",
    "ChannelMember",
    "CustomEmoji",
    "Invite",
    "Message",
    "PasswordReset",
    "PushSubscription",
    "Reaction",
    "ReadState",
    "Session",
    "String",
    "ThreadSubscription",
    "User",
    "Webhook",
    "Workspace",
    "WorkspaceSettings",
]
