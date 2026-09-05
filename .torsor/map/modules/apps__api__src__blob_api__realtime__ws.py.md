---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/realtime/ws.py

Symbols in `apps/api/src/blob_api/realtime/ws.py`.

- L37 `websocket_endpoint(websocket: WebSocket)` (function)
- L115 `_writer(websocket: WebSocket, conn: hub.Connection)` (function) — Drain the connection's outbox.
- L129 `_reader(websocket: WebSocket, conn: hub.Connection, user: SessionUser)` (function)
- L202 `_visible_users(user_ids: list[str], workspace_id: str)` (function) — Which of these ids the caller is allowed to know anything about.
- L224 `_now_iso()` (function)
