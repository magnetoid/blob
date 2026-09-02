"""Response models — the shapes `packages/shared/src/types.ts` describes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator

from .base import CamelModel

UserRole = Literal["member", "admin", "owner"]
UserKind = Literal["human", "bot"]
ChannelKind = Literal["public", "private", "dm", "group_dm"]
NotifyLevel = Literal["all", "mentions", "none"]
MessageKind = Literal["user", "system", "bot"]
PresenceState = Literal["active", "away", "offline"]
AgentTaskStatus = Literal["todo", "in_progress", "blocked", "done", "cancelled"]
AgentTaskPriority = Literal["low", "medium", "high", "critical"]


class QuietHours(CamelModel):
    """When not to interrupt somebody.

    A shape rather than a bare dict, because this is read by the notify job on every
    message for every recipient, and a value it cannot handle takes the whole job down
    — not just that person's notification, but everyone's in the channel. It was
    `dict[str, Any]`, so `{"enabled": true, "startHour": "nine"}` was stored happily and
    then raised `ValueError` inside `is_snoozed` for every message thereafter. Any member
    could switch off their team's notifications by saving their own preferences once.

    The hours are bounded to a real clock and the days to a real week, so the values that
    reach `int()` and the weekday comparison cannot be anything else.
    """

    enabled: bool = False
    #: Local hour the working window opens; quiet hours are *outside* [start, end).
    start_hour: int = Field(default=9, ge=0, le=23)
    end_hour: int = Field(default=18, ge=0, le=23)
    #: Sunday=0, matching JavaScript's getDay(), which is what the client sends.
    days: list[int] = Field(default_factory=list)

    @field_validator("days")
    @classmethod
    def _real_days(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("A day of the week is 0 (Sunday) through 6.")
        return value


class UserPrefs(CamelModel):
    theme: Literal["light", "dark", "system"] = "system"
    density: Literal["comfortable", "compact", "airy"] = "comfortable"
    #: Which named theme fills each side; `theme` still decides which side applies.
    theme_light: str = "paper"
    theme_dark: str = "midnight"
    #: Words that trigger a notification anywhere in the workspace.
    keywords: list[str] = Field(default_factory=list)
    #: Quiet hours; notifications are suppressed outside [start, end) local time.
    dnd: QuietHours | None = None
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


class BrowsableChannel(CamelModel):
    """A public channel as the directory lists it.

    Deliberately not `ChannelWithState`: the directory answers a different question —
    "what is there, how busy is it, am I in it" — and folding a member count into the
    sidebar's own query would make every bootstrap pay for a number only this screen
    shows.
    """

    id: str
    name: str | None = None
    topic: str | None = None
    description: str | None = None
    created_at: str
    archived_at: str | None = None
    member_count: int
    joined: bool


class ScheduledMessage(CamelModel):
    """A message waiting to be sent. Only ever the author's own."""

    id: str
    channel_id: str
    body: str
    thread_root_id: str | None = None
    send_at: str
    created_at: str
    #: Why it did not go, when it did not go.
    last_error: str | None = None
    #: "daily", "weekdays", "weekly" — or None, which is the schedule that happens once.
    repeat: str | None = None
    #: When a repeating one last went out. `sendAt` is always the *next* occurrence, so
    #: without this a recurring row gives the client no way to say "sent, and again on
    #: Monday".
    last_sent_at: str | None = None


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
    #: Every group in the workspace — the client needs them all to render a mention,
    #: since a message can name a group you are not in.
    groups: list[UserGroup] = Field(default_factory=list)
    #: Which of them are yours, so "mentions you" can include being named as part of a
    #: team. Ids only, for the same reason `saved_message_ids` is.
    my_group_ids: list[str] = Field(default_factory=list)
    muted_group_ids: list[str] = Field(default_factory=list)
    #: The commit this server is running, if the host said which. The client stamps its
    #: own at build time and prefers that; this is what answers when the build could not
    #: read a repository, which is the ordinary case for a deploy from a source tree.
    server_commit: str | None = None


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
