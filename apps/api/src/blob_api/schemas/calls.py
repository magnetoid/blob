"""Calls: a huddle or a meetup — a LiveKit room belonging to one conversation."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..lib.ids import IdParam
from .base import CamelModel

CallKind = Literal["huddle", "meetup"]


class Call(CamelModel):
    id: str
    channel_id: str
    kind: CallKind
    created_by: str
    status: Literal["active", "ended"]
    created_at: str
    ended_at: str | None = None
    #: Who is connected right now, in the order they arrived. An ended call has nobody.
    participant_ids: list[str] = Field(default_factory=list)


class CallStart(CamelModel):
    channel_id: IdParam
    kind: CallKind


class CallToken(CamelModel):
    token: str
    #: What the browser dials: the public `wss://` address.
    url: str


class HuddleSettings(CamelModel):
    enabled: bool = True
    cameras: bool = True
    screen_share: bool = True
    max_participants: int = Field(default=50, ge=2, le=100)


class MeetupSettings(CamelModel):
    enabled: bool = True
    cameras_on_join: bool = True
    max_participants: int = Field(default=50, ge=2, le=100)


class CallSettings(CamelModel):
    huddles: HuddleSettings = Field(default_factory=HuddleSettings)
    meetups: MeetupSettings = Field(default_factory=MeetupSettings)


class CallsState(CamelModel):
    #: Whether this server has a media server at all. False draws no call buttons —
    #: the same rule as `translationEnabled`.
    available: bool
    settings: CallSettings
    calls: list[Call]


class MediaServerStatus(CamelModel):
    configured: bool
    url: str | None = None
    reachable: bool | None = None
    latency_ms: int | None = None
    error: str | None = None
    open_rooms: int | None = None
    last_event_at: str | None = None
    #: Where LiveKit has to send its webhooks for this server to hear who joined.
    webhook_url: str
