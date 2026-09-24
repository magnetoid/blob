---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/lib/livekit.py

Symbols in `apps/api/src/blob_api/lib/livekit.py`.

- L45 `Unavailable` (class) — LiveKit did not answer, or answered with an error.
- L49 `BadSignature` (class) — A webhook LiveKit did not sign with our key.
- L54 `Participant` (class)
- L61 `Rooms` (class)
- L62 `ensure(self, name: str, max_participants: int)` (method)
- L63 `close(self, name: str)` (method)
- L64 `names(self)` (method)
- L65 `participants(self, name: str)` (method)
- L66 `remove_participant(self, name: str, identity: str)` (method)
- L69 `configured()` (function)
- L73 `browser_url()` (function)
- L77 `api_url()` (function)
- L88 `_LiveKitRooms` (class) — LiveKit's RoomService, over its HTTP API.
- L95 `_client(self)` (method)
- L108 `ensure(self, name: str, max_participants: int)` (method)
- L125 `close(self, name: str)` (method)
- L135 `names(self)` (method)
- L143 `participants(self, name: str)` (method)
- L155 `remove_participant(self, name: str, identity: str)` (method)
- L174 `token(identity: str, display_name: str, room: str, sources: list[str])` (function) — A pass into one room, publishing only `sources`.
- L197 `receive(body: str, authorization: str)` (function) — A webhook, if LiveKit signed exactly this body with our key; `BadSignature` if not.
