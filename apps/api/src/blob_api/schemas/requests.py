"""Request bodies — the Pydantic mirror of `packages/shared/src/schemas.ts`.

Validation messages are user-facing: the client renders `error.message` directly, so
they read as sentences rather than as validator names.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import EmailStr, Field, StringConstraints, field_validator, model_validator

from ..lib.ids import IdParam
from .base import CamelModel
from .models import QuietHours

MESSAGE_MAX_LENGTH = 12_000

Password = Annotated[str, StringConstraints(min_length=10, max_length=200)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]

CHANNEL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]*$")


class ChannelNameMixin:
    @staticmethod
    def _check_channel_name(value: str) -> str:
        name = value.strip().lower()
        if not name:
            raise ValueError("Enter a channel name.")
        if len(name) > 64:
            raise ValueError("Channel names are limited to 64 characters.")
        if not CHANNEL_NAME_RE.match(name):
            raise ValueError("Use lowercase letters, numbers, hyphens and underscores.")
        return name


class SignupInput(CamelModel):
    email: EmailStr
    password: Password
    display_name: DisplayName
    #: Present unless this is the very first user, who founds the workspace.
    invite_token: str | None = Field(default=None, min_length=10)
    workspace_name: str | None = Field(default=None, max_length=60)


class LoginInput(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ForgotPasswordInput(CamelModel):
    email: EmailStr


class ResetPasswordInput(CamelModel):
    token: str = Field(min_length=10)
    password: Password


class CreateInviteInput(CamelModel):
    email: EmailStr | None = None
    expires_in_days: int = Field(default=7, ge=1, le=30)
    role: Literal["member", "admin"] = "member"


class CreateChannelInput(CamelModel, ChannelNameMixin):
    name: str
    kind: Literal["public", "private"]
    topic: str | None = Field(default=None, max_length=250)
    description: str | None = Field(default=None, max_length=2000)
    member_ids: list[IdParam] | None = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return cls._check_channel_name(value)


class UpdateChannelInput(CamelModel, ChannelNameMixin):
    name: str | None = None
    topic: str | None = Field(default=None, max_length=250)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else cls._check_channel_name(value)


class MembershipUpdateInput(CamelModel):
    notify_level: Literal["all", "mentions", "none"] | None = None
    is_starred: bool | None = None


class CreateDmInput(CamelModel):
    user_ids: list[IdParam] = Field(min_length=1, max_length=8)


class SendMessageInput(CamelModel):
    body: str = Field(default="", max_length=MESSAGE_MAX_LENGTH)
    client_msg_id: str = Field(min_length=8, max_length=64)
    thread_root_id: IdParam | None = None
    also_in_channel: bool = False
    attachment_ids: list[IdParam] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _needs_content(self) -> SendMessageInput:
        if not self.body.strip() and not self.attachment_ids:
            raise ValueError("Write something or attach a file.")
        return self


class RunCommandInput(CamelModel):
    """A slash command, as typed.

    `text` arrives with the leading slash still on it. The server does the parsing so
    that a client which has never heard of a particular command still routes it here —
    which is the whole point of dispatching centrally.
    """

    #: Shape-checked, because it reaches `assert_channel_access` and the hand-written SQL
    #: below it: a malformed one raised out of asyncpg and answered 500 where every other
    #: id-taking route answers 400.
    channel_id: IdParam
    text: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)
    #: A command may post a message, and that write is idempotent like every other.
    client_msg_id: str = Field(min_length=8, max_length=64)


class EditMessageInput(CamelModel):
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MESSAGE_MAX_LENGTH)
    ]


class ReactionInput(CamelModel):
    emoji: str = Field(min_length=1, max_length=64)


class MarkReadInput(CamelModel):
    last_read_message_id: IdParam


class PinInput(CamelModel):
    pinned: bool


class SaveInput(CamelModel):
    saved: bool


class MarkUnreadInput(CamelModel):
    #: The message to leave unread. The cursor lands on the one before it.
    message_id: IdParam


class CreateGroupInput(CamelModel):
    #: Validated properly in `services/user_groups.clean_handle`, which also strips a
    #: leading "@" — the shape is enforced by a CHECK, this is only a length floor.
    handle: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=280)


class UpdateGroupInput(CamelModel):
    handle: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=280)


class MuteGroupInput(CamelModel):
    muted: bool


class FollowThreadInput(CamelModel):
    following: bool


class UpdateProfileInput(CamelModel):
    display_name: DisplayName | None = None
    full_name: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=80)
    timezone: str | None = Field(default=None, max_length=60)
    status_emoji: str | None = Field(default=None, max_length=64)
    status_text: str | None = Field(default=None, max_length=100)
    status_expires_at: str | None = None
    #: An upload the caller made, by attachment id; null clears the picture. The route
    #: resolves it to an object key itself — the client never learns storage keys.
    avatar_attachment_id: str | None = Field(default=None, max_length=64)


class UpdatePrefsInput(CamelModel):
    theme: Literal["light", "dark", "system"] | None = None
    density: Literal["comfortable", "compact", "airy"] | None = None
    theme_light: str | None = Field(default=None, max_length=40)
    theme_dark: str | None = Field(default=None, max_length=40)
    keywords: list[str] | None = Field(default=None, max_length=30)
    dnd: QuietHours | None = None
    snooze_until: str | None = None
    enter_to_send: bool | None = None
    language: str | None = Field(default=None, min_length=2, max_length=16)
    auto_translate: bool | None = None


class UploadRequestInput(CamelModel):
    filename: str = Field(min_length=1, max_length=255)
    mime: str = Field(min_length=1, max_length=150)
    size_bytes: int = Field(gt=0, le=100 * 1024 * 1024)


class UploadCompleteInput(CamelModel):
    width: int | None = Field(default=None, gt=0, le=20_000)
    height: int | None = Field(default=None, gt=0, le=20_000)


class PushSubscriptionKeys(CamelModel):
    p256dh: str
    auth: str


class PushSubscriptionInput(CamelModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeInput(CamelModel):
    endpoint: str


class AddMembersInput(CamelModel):
    user_ids: list[IdParam] = Field(min_length=1, max_length=50)


class WebhookPostInput(CamelModel):
    text: str = Field(min_length=1, max_length=MESSAGE_MAX_LENGTH)
    username: str | None = Field(default=None, max_length=40)
    #: Lets a CI system retry a timed-out POST without duplicating the message. When
    #: absent the server mints one, which keeps the write idempotent in name only.
    client_msg_id: str | None = Field(default=None, min_length=8, max_length=64)


class CreateAgentTaskInput(CamelModel):
    title: str = Field(min_length=1, max_length=140)
    instructions: str = Field(default="", max_length=4000)
    assignee_user_id: str | None = None
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    due_at: str | None = None
    summary_id: str | None = None
    external_ref: dict[str, str] = Field(default_factory=dict)


class UpdateAgentTaskInput(CamelModel):
    assignee_user_id: str | None = None
    status: Literal["todo", "in_progress", "blocked", "done", "cancelled"] | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    due_at: str | None = None
    outcome: str | None = Field(default=None, max_length=4000)
    instructions: str | None = Field(default=None, max_length=4000)


class TranslateMessageInput(CamelModel):
    target_language: str | None = Field(default=None, min_length=2, max_length=16)
    force_refresh: bool = False


class FeedbackInput(CamelModel):
    kind: Literal["bug", "feedback", "feature"]
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(default="", max_length=8000)
    #: Captured by the browser at the moment of reporting; all optional, because a
    #: ticket with no diagnostics is still worth more than no ticket.
    environment: dict[str, str] = Field(default_factory=dict)
    console_log: str = Field(default="", max_length=64_000)
    snapshot: str = Field(default="", max_length=2_000_000)


class FeedbackStatusInput(CamelModel):
    status: Literal["open", "closed"]
