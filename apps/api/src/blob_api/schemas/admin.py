"""What the workspace console reads and writes.

Moved out of `routers/admin.py` with the SQL that fills them, so the router is left with
shape-and-authorize and the service can build the answer it is asked for.
"""

from __future__ import annotations

from typing import Any, Literal

from .base import CamelModel


class AdminUser(CamelModel):
    """Richer than the public `User`, which deliberately omits email."""

    id: str
    email: str
    display_name: str
    full_name: str | None = None
    title: str | None = None
    role: str
    deactivated_at: str | None = None
    created_at: str
    last_seen_at: str | None = None
    session_count: int = 0
    channel_count: int = 0
    message_count: int = 0


class AdminUsersOut(CamelModel):
    users: list[AdminUser]
    total: int


class RoleInput(CamelModel):
    role: Literal["member", "admin", "owner"]


class AdminChannel(CamelModel):
    id: str
    kind: str
    name: str | None
    topic: str | None
    created_by: str | None
    created_at: str
    archived_at: str | None
    member_count: int
    message_count: int
    last_message_at: str | None


class AdminChannelsOut(CamelModel):
    channels: list[AdminChannel]


class AdminInvite(CamelModel):
    id: str
    email: str | None
    role: str
    created_by: str | None
    created_by_name: str | None
    created_at: str
    expires_at: str
    accepted_at: str | None
    accepted_by_name: str | None
    revoked_at: str | None
    status: Literal["pending", "accepted", "expired", "revoked"]


class AdminInvitesOut(CamelModel):
    invites: list[AdminInvite]


class WorkspaceSettingsOut(CamelModel):
    name: str
    slug: str
    settings: dict[str, Any]


class SettingsInput(CamelModel):
    name: str | None = None
    settings: dict[str, Any] | None = None


class AdminDeliveryOut(CamelModel):
    id: str
    plugin_id: str
    plugin_name: str
    event: str
    status: str
    attempts: int
    last_status_code: int | None = None
    last_error: str | None = None
    created_at: str
    delivered_at: str | None = None
    next_attempt_at: str | None = None


class AdminDeliveriesOut(CamelModel):
    deliveries: list[AdminDeliveryOut]


class HealthOut(CamelModel):
    database: bool
    redis: bool
    #: "ok" | "unreachable" | "unconfigured". An invitation whose email never goes is
    #: indistinguishable from one that does, from the inside, so it is reported here.
    mail: str
    #: Whether VAPID keys are set. Without them nobody can be told anything while their
    #: tab is closed.
    push: bool
    #: "ok" | "unconfigured" | "private" | "unreachable". Whether a *browser* can reach
    #: object storage, which is a different question from whether this process can —
    #: uploads go straight from the browser to the bucket.
    storage: str
    queue_depth: int
    connections: int
    users_online: int
    message_count: int
    storage_bytes: int
    version: str


class WebhookOut(CamelModel):
    id: str
    name: str
    channel_id: str
    created_at: str
    last_used_at: str | None
    #: Returned once, at creation. The raw token is never recoverable afterwards.
    url: str | None = None


class WebhooksOut(CamelModel):
    webhooks: list[WebhookOut]


class CreateWebhookInput(CamelModel):
    channel_id: str
    name: str


class ResetLinkOut(CamelModel):
    url: str
    expires_at: str
