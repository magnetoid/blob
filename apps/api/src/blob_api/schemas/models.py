"""Response models — the shapes `packages/shared/src/types.ts` describes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from .base import CamelModel

UserRole = Literal["member", "admin", "owner"]
UserKind = Literal["human", "bot"]
ChannelKind = Literal["public", "private", "dm", "group_dm"]
NotifyLevel = Literal["all", "mentions", "none"]
MessageKind = Literal["user", "system", "bot"]
PresenceState = Literal["active", "away", "offline"]
AgentTaskStatus = Literal["todo", "in_progress", "blocked", "done", "cancelled"]
AgentTaskPriority = Literal["low", "medium", "high", "critical"]


class UserPrefs(CamelModel):
    theme: Literal["light", "dark", "system"] = "system"
    density: Literal["comfortable", "compact", "airy"] = "comfortable"
    #: Which named theme fills each side; `theme` still decides which side applies.
    theme_light: str = "paper"
    theme_dark: str = "midnight"
    #: Words that trigger a notification anywhere in the workspace.
    keywords: list[str] = Field(default_factory=list)
    #: Quiet hours; notifications are suppressed outside [start, end) local time.
    dnd: dict[str, Any] | None = None
    #: Manual snooze until this ISO timestamp.
    snooze_until: str | None = None
    enter_to_send: bool = True
    language: str | None = None
    auto_translate: bool = False


DEFAULT_PREFS = UserPrefs()


class User(CamelModel):
    """Public shape of a user. Never includes password_hash or another user's email."""

    id: str
    kind: UserKind = "human"
    display_name: str
    full_name: str | None = None
    title: str | None = None
    avatar_url: str | None = None
    timezone: str = "UTC"
    role: UserRole = "member"
    status_emoji: str | None = None
    status_text: str | None = None
    status_expires_at: str | None = None
    deactivated: bool = False


class CurrentUser(User):
    """The signed-in user sees more of themselves than of others."""

    email: str
    prefs: UserPrefs


class Workspace(CamelModel):
    id: str
    name: str
    slug: str
    created_at: str


class Channel(CamelModel):
    id: str
    kind: ChannelKind
    #: null for DMs — clients render the other member's name instead.
    name: str | None = None
    topic: str | None = None
    description: str | None = None
    created_by: str | None = None
    archived_at: str | None = None
    last_message_id: str | None = None
    created_at: str
    #: Present only for dm / group_dm.
    member_ids: list[str] | None = None


class Membership(CamelModel):
    notify_level: NotifyLevel
    is_starred: bool
    joined_at: str


class ChannelWithState(Channel):
    """A channel as it appears in the sidebar, with this user's own state folded in."""

    membership: Membership | None = None
    has_unread: bool = False
    mention_count: int = 0
    last_read_message_id: str | None = None


class Attachment(CamelModel):
    id: str
    filename: str
    mime: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    url: str
    thumb_url: str | None = None


class Reaction(CamelModel):
    emoji: str
    #: Users who reacted, in the order they reacted.
    user_ids: list[str]


class LinkPreview(CamelModel):
    url: str
    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    site_name: str | None = None


class Message(CamelModel):
    id: str
    channel_id: str
    author_id: str | None = None
    kind: MessageKind = "user"
    body: str = ""
    thread_root_id: str | None = None
    also_in_channel: bool = False
    reply_count: int = 0
    reply_user_ids: list[str] = Field(default_factory=list)
    last_reply_at: str | None = None
    mention_user_ids: list[str] = Field(default_factory=list)
    #: Groups this message named, kept as groups — never flattened into the line
    #: above, which means "people this message named directly".
    mention_group_ids: list[str] = Field(default_factory=list)
    mentions_everyone: bool = False
    client_msg_id: str
    edited_at: str | None = None
    deleted_at: str | None = None
    pinned_at: str | None = None
    created_at: str
    reactions: list[Reaction] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    #: Structured content beside `body`, which stays the plain-text fallback.
    blocks: list[dict[str, Any]] | None = None
    #: Which app posted this, when one did.
    plugin_id: str | None = None
    link_preview: LinkPreview | None = None


class CustomEmoji(CamelModel):
    name: str
    url: str


class CommandSpec(CamelModel):
    """One slash command, as the composer's autocomplete needs to describe it.

    Sent on bootstrap rather than hardcoded in the client, because the server owns the
    command namespace — which is what lets an app-provided command appear in the
    autocomplete without the client learning anything about it.
    """

    name: str
    usage: str
    summary: str


class ThemeSummary(CamelModel):
    id: str
    slug: str
    name: str
    mode: Literal["light", "dark"]
    tokens: dict[str, str]
    is_preset: bool
    is_enabled: bool


class ThreadSummaryDecision(CamelModel):
    text: str
    message_id: str | None = None


class ThreadSummaryActionItem(CamelModel):
    text: str
    assignee_user_id: str | None = None
    source_message_id: str | None = None


class ThreadSummary(CamelModel):
    id: str
    channel_id: str
    thread_root_id: str
    created_by: str | None = None
    provider: str
    overview: str
    decisions: list[ThreadSummaryDecision] = Field(default_factory=list)
    action_items: list[ThreadSummaryActionItem] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    participant_ids: list[str] = Field(default_factory=list)
    message_count: int = 0
    created_at: str
    updated_at: str


class AgentTask(CamelModel):
    id: str
    channel_id: str
    thread_root_id: str | None = None
    created_by: str | None = None
    assignee_user_id: str | None = None
    assignee_kind: UserKind | None = None
    summary_id: str | None = None
    title: str
    instructions: str = ""
    status: AgentTaskStatus = "todo"
    priority: AgentTaskPriority = "medium"
    due_at: str | None = None
    completed_at: str | None = None
    outcome: str | None = None
    external_ref: dict[str, str] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class MessageTranslation(CamelModel):
    id: str
    message_id: str
    requested_by: str | None = None
    provider: str
    source_language: str | None = None
    target_language: str
    translated_text: str
    cached: bool = False
    created_at: str
    updated_at: str


class UserGroup(CamelModel):
    """A named set of people, mentionable as one handle."""

    id: str
    handle: str
    name: str
    description: str | None = None
    member_count: int = 0


class Bootstrap(CamelModel):
    """Everything the client needs on boot, in one round trip."""

    workspace: Workspace
    user: CurrentUser
    users: list[User]
    channels: list[ChannelWithState]
    custom_emoji: list[CustomEmoji]
    commands: list[CommandSpec]
    themes: list[ThemeSummary]
    #: Ids only. Which messages you saved is per-user state, and putting the flag on
    #: `Message` would mean threading a user id through the select every broadcast is
    #: built from. The Later view fetches the messages themselves.
    saved_message_ids: list[str] = Field(default_factory=list)


class ReadStateOut(CamelModel):
    channel_id: str
    last_read_message_id: str | None = None
    mention_count: int = 0


class FeedbackTicket(CamelModel):
    id: str
    kind: Literal["bug", "feedback", "feature"]
    title: str
    body: str
    status: Literal["open", "closed"]
    reporter_id: str | None = None
    environment: dict[str, str] = Field(default_factory=dict)
    console_log: str = ""
    has_snapshot: bool = False
    created_at: str
    resolved_at: str | None = None
    resolved_by: str | None = None
