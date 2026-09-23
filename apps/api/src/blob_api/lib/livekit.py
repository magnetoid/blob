"""The one module that talks to LiveKit.

Blob mints the tokens and LiveKit carries the media. Everything this process says to the
media server goes through here, which is what lets a test replace one object — `rooms` —
instead of patching the SDK wherever it is used, and keeps `livekit` imported in one file.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol

import aiohttp
from livekit import api

from ..config import settings

#: A token only has to last until the connect. Once connected, LiveKit refreshes a
#: participant's token itself, so a long call does not need a long-lived one — and a
#: short one is useless to anybody who finds it in a log later.
TOKEN_TTL = timedelta(minutes=10)

#: How long a room outlives its last participant: long enough that a reload rejoins the
#: same call, short enough that "everyone left" ends it.
DEPARTURE_TIMEOUT_S = 20

#: How long a room waits for its first participant. A start whose starter never
#: connected — microphone refused, tab closed — closes itself instead of offering Join.
EMPTY_TIMEOUT_S = 120

_API_TIMEOUT = aiohttp.ClientTimeout(total=5)

#: What a participant may publish, in LiveKit's own names.
MICROPHONE = "microphone"
CAMERA = "camera"
SCREEN_SHARE = "screen_share"
SCREEN_SHARE_AUDIO = "screen_share_audio"


# Both names are the exact ones later tasks in this feature import (see the task
# brief's Interfaces list), so ruff's Error-suffix rule is suppressed here rather
# than the names changed.
class Unavailable(Exception):  # noqa: N818
    """LiveKit did not answer, or answered with an error."""


class BadSignature(Exception):  # noqa: N818
    """A webhook LiveKit did not sign with our key."""


@dataclass(frozen=True, slots=True)
class Participant:
    #: The identity we put in the token: a user id.
    identity: str
    #: LiveKit's id for this one connection. A rejoin gets a new one.
    sid: str


class Rooms(Protocol):
    async def ensure(self, name: str, max_participants: int) -> None: ...
    async def close(self, name: str) -> None: ...
    async def names(self) -> set[str]: ...
    async def participants(self, name: str) -> list[Participant]: ...
    async def remove_participant(self, name: str, identity: str) -> None: ...


def configured() -> bool:
    return bool(settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET)


def browser_url() -> str:
    return settings.LIVEKIT_URL or ""


def api_url() -> str:
    return settings.LIVEKIT_API_URL or settings.LIVEKIT_URL or ""


#: `ValueError` is here for `api.LiveKitAPI`, which raises it synchronously — before any
#: request goes out — when it is built with no url. Every caller checks `configured()`
#: first, so this is unreachable in practice, but the one thing this module promises is
#: that nothing LiveKit-shaped escapes as anything other than `Unavailable`.
_FAILURES = (api.TwirpError, aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError)


class _LiveKitRooms:
    """LiveKit's RoomService, over its HTTP API.

    A client per call rather than a pooled session: these run a few times a minute at
    most, and a pool would need somebody to close it on shutdown.
    """

    def _client(self) -> api.LiveKitAPI:
        return api.LiveKitAPI(
            api_url(),
            settings.LIVEKIT_API_KEY,
            settings.LIVEKIT_API_SECRET,
            timeout=_API_TIMEOUT,
            # The SDK only skips its cross-region retry when the timeout is strictly
            # under 5s; at exactly 5s a LiveKit Cloud host would still retry across
            # up to three regions, turning our 5s budget into ~20s. We want one
            # fast-failing attempt, not a silent multiplier on every call here.
            failover=False,
        )

    async def ensure(self, name: str, max_participants: int) -> None:
        # CreateRoom answers with the existing room when there is one, which is what lets
        # the token route call this again: a room LiveKit already closed comes back with
        # our cap, rather than being auto-created by the join without one.
        try:
            async with self._client() as lk:
                await lk.room.create_room(
                    api.CreateRoomRequest(
                        name=name,
                        max_participants=max_participants,
                        empty_timeout=EMPTY_TIMEOUT_S,
                        departure_timeout=DEPARTURE_TIMEOUT_S,
                    )
                )
        except _FAILURES as exc:
            raise Unavailable(str(exc)) from exc

    async def close(self, name: str) -> None:
        try:
            async with self._client() as lk:
                await lk.room.delete_room(api.DeleteRoomRequest(room=name))
        except api.TwirpError as exc:
            if exc.code != api.TwirpErrorCode.NOT_FOUND:
                raise Unavailable(str(exc)) from exc
        except _FAILURES as exc:
            raise Unavailable(str(exc)) from exc

    async def names(self) -> set[str]:
        try:
            async with self._client() as lk:
                listed = await lk.room.list_rooms(api.ListRoomsRequest())
        except _FAILURES as exc:
            raise Unavailable(str(exc)) from exc
        return {room.name for room in listed.rooms}

    async def participants(self, name: str) -> list[Participant]:
        try:
            async with self._client() as lk:
                listed = await lk.room.list_participants(api.ListParticipantsRequest(room=name))
        except api.TwirpError as exc:
            if exc.code == api.TwirpErrorCode.NOT_FOUND:
                return []
            raise Unavailable(str(exc)) from exc
        except _FAILURES as exc:
            raise Unavailable(str(exc)) from exc
        return [Participant(identity=p.identity, sid=p.sid) for p in listed.participants]

    async def remove_participant(self, name: str, identity: str) -> None:
        # A participant already gone — they left as this was asked for, or the room
        # itself is — is exactly what this call wanted, not a failure to report.
        try:
            async with self._client() as lk:
                await lk.room.remove_participant(
                    api.RoomParticipantIdentity(room=name, identity=identity)
                )
        except api.TwirpError as exc:
            if exc.code != api.TwirpErrorCode.NOT_FOUND:
                raise Unavailable(str(exc)) from exc
        except _FAILURES as exc:
            raise Unavailable(str(exc)) from exc


#: Replaced by a fake in every test; see `tests/fake_livekit.py`.
rooms: Rooms = _LiveKitRooms()


def token(identity: str, display_name: str, room: str, sources: list[str]) -> str:
    """A pass into one room, publishing only `sources`."""
    return (
        api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(display_name)
        .with_ttl(TOKEN_TTL)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                # Blob is the chat. LiveKit's data channel would be a second one that
                # nothing stores, searches or moderates.
                can_publish_data=False,
                can_publish_sources=sources,
            )
        )
        .to_jwt()
    )


def receive(body: str, authorization: str) -> api.WebhookEvent:
    """A webhook, if LiveKit signed exactly this body with our key; `BadSignature` if not."""
    if not configured():
        raise BadSignature("LiveKit is not configured here.")
    jwt = authorization.removeprefix("Bearer ").strip()
    receiver = api.WebhookReceiver(
        api.TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    )
    try:
        return receiver.receive(body, jwt)
    except Exception as exc:  # the SDK raises bare Exception for a hash mismatch
        raise BadSignature(str(exc)) from exc
