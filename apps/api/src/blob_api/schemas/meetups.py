from __future__ import annotations

from pydantic import Field

from .base import CamelModel


class MeetupCreate(CamelModel):
    name: str = Field(..., min_length=1, max_length=100)
    channel_id: str | None = None


class MeetupOut(CamelModel):
    id: str
    workspace_id: str
    channel_id: str | None
    created_by: str
    name: str
    status: str
    created_at: str
    ended_at: str | None


class MeetupTokenOut(CamelModel):
    token: str
    url: str
