---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/realtime/ws.py

Symbols in `apps/api/src/blob_api/realtime/ws.py`.

- L34 `websocket_endpoint(websocket: WebSocket)` (function)
- L99 `_writer(websocket: WebSocket, conn: hub.Connection)` (function) — Drain the connection's outbox.
- L113 `_reader(websocket: WebSocket, conn: hub.Connection, user: SessionUser)` (function)
- L170 `_visible_users(user_ids: list[str], workspace_id: str)` (function) — Which of these ids the caller is allowed to know anything about.
- L192 `_now_iso()` (function)
