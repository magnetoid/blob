---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T22:18:44'
updated: '2026-08-21T22:18:44'
---

# apps/api/src/blob_api/realtime/hub.py

Symbols in `apps/api/src/blob_api/realtime/hub.py`.

- L34 `Connection` (class)
- L54 `send(self, event: ServerEvent)` (method) — Queue an event.
- L70 `close(self)` (method)
- L87 `new_connection(connection_id: str, user_id: str)` (function)
- L91 `register(conn: Connection)` (function)
- L96 `unregister(conn: Connection)` (function)
- L107 `set_presence_subs(conn: Connection, user_ids: list[str])` (function) — Replace what this connection watches, and keep the reverse index in step.
- L117 `subscribe_channels(conn: Connection, channel_ids: list[str])` (function)
- L125 `unsubscribe_channel(conn: Connection, channel_id: str)` (function)
- L132 `to_channel(channel_id: str, event: ServerEvent)` (function) — Everyone currently subscribed to a channel.
- L138 `to_users(user_ids: list[str], event: ServerEvent)` (function) — Every connection belonging to these users (all their devices).
- L146 `to_all(event: ServerEvent)` (function) — Everyone connected — used for workspace-wide facts like a profile change.
- L152 `to_presence_subscribers(user_id: str, event: ServerEvent)` (function) — Presence updates go only to connections that asked about this user.
- L158 `_deliver_presence(user_id: str, event: ServerEvent)` (function)
- L163 `is_user_online(user_id: str)` (function)
- L167 `focused_channels(user_id: str)` (function) — Which channel each of a user's connections is currently focused on.
- L174 `connections_for_user(user_id: str)` (function)
- L178 `stats()` (function)
- L186 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L205 `_publish(envelope: dict[str, Any])` (function)
- L216 `_publish_async(envelope: dict[str, Any])` (function)
- L220 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L230 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L264 `stop_redis_bridge()` (function)
- L272 `reset_for_tests()` (function)
- L279 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L283 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
