"""LiveKit, as far as the tests need it: rooms that exist, and who is in them."""

from __future__ import annotations

from blob_api.lib import livekit
from blob_api.lib.livekit import Participant


class FakeRooms:
    def __init__(self) -> None:
        #: room name → the cap it was created with
        self.rooms: dict[str, int] = {}
        self.people: dict[str, list[Participant]] = {}
        self.closed: list[str] = []
        #: (room name, identity) pairs asked to leave, in order.
        self.removed: list[tuple[str, str]] = []
        #: Flip to make every call fail the way an unreachable LiveKit does.
        self.down = False

    def _answer(self) -> None:
        if self.down:
            raise livekit.Unavailable("LiveKit is down (fake)")

    async def ensure(self, name: str, max_participants: int) -> None:
        self._answer()
        self.rooms.setdefault(name, max_participants)

    async def close(self, name: str) -> None:
        self._answer()
        self.rooms.pop(name, None)
        self.people.pop(name, None)
        self.closed.append(name)

    async def names(self) -> set[str]:
        self._answer()
        return set(self.rooms)

    async def participants(self, name: str) -> list[Participant]:
        self._answer()
        return list(self.people.get(name, []))

    async def remove_participant(self, name: str, identity: str) -> None:
        self._answer()
        self.people[name] = [p for p in self.people.get(name, []) if p.identity != identity]
        self.removed.append((name, identity))
