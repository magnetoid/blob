"""Response models — the shapes `packages/shared/src/types.ts` describes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from .base import CamelModel

UserRole = Literal["member", "admin", "owner"]
ChannelKind = Literal["public", "private", "dm", "group_dm"]
NotifyLevel = Literal["all", "mentions", "none"]
MessageKind = Literal["user", "system", "bot"]
PresenceState = Literal["active", "away", "offline"]


class UserPrefs(CamelModel):
    theme: Literal["light", "dark", "system"] = "system"
    density: Literal["comfortable", "compact", "airy"] = "comfortable"
    #: Words that trigger a notification anywhere in the workspace.
    keywords: list[str] = Field(default_factory=list)
    #: Quiet hours; notifications are suppressed outside [start, end) local time.
    dnd: dict[str, Any] | None = None
    #: Manual snooze until this ISO timestamp.
    snooze_until: str | None = None
    enter_to_send: bool = True


DEFAULT_PREFS = UserPrefs()


class User(CamelModel):
    """Public shape of a user. Never includes password_hash or another user's email."""

    id: str
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
    mentions_everyone: bool = False
    client_msg_id: str
    edited_at: str | None = None
    deleted_at: str | None = None
    pinned_at: str | None = None
    created_at: str
    reactions: list[Reaction] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    link_preview: LinkPreview | None = None


class CustomEmoji(CamelModel):
    name: str
    url: str


class Bootstrap(CamelModel):
    """Everything the client needs on boot, in one round trip."""

    workspace: Workspace
    user: CurrentUser
    users: list[User]
    channels: list[ChannelWithState]
    custom_emoji: list[CustomEmoji]


class ReadStateOut(CamelModel):
    channel_id: str
    last_read_message_id: str | None = None
    mention_count: int = 0
