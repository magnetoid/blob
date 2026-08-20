---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/realtime/hub.py

Symbols in `apps/api/src/blob_api/realtime/hub.py`.

- L34 `Connection` (class)
- L46 `send(self, event: ServerEvent)` (method) — Queue an event.
- L61 `close(self)` (method)
- L72 `new_connection(connection_id: str, user_id: str)` (function)
- L76 `register(conn: Connection)` (function)
- L81 `unregister(conn: Connection)` (function)
- L90 `subscribe_channels(conn: Connection, channel_ids: list[str])` (function)
- L98 `unsubscribe_channel(conn: Connection, channel_id: str)` (function)
- L105 `to_channel(channel_id: str, event: ServerEvent)` (function) — Everyone currently subscribed to a channel.
- L111 `to_users(user_ids: list[str], event: ServerEvent)` (function) — Every connection belonging to these users (all their devices).
- L119 `to_all(event: ServerEvent)` (function) — Everyone connected — used for workspace-wide facts like a profile change.
- L125 `to_presence_subscribers(user_id: str, event: ServerEvent)` (function) — Presence updates go only to connections that asked about this user.
- L133 `is_user_online(user_id: str)` (function)
- L137 `focused_channels(user_id: str)` (function) — Which channel each of a user's connections is currently focused on.
- L144 `connections_for_user(user_id: str)` (function)
- L148 `stats()` (function)
- L156 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L175 `_publish(envelope: dict[str, Any])` (function)
- L186 `_publish_async(envelope: dict[str, Any])` (function)
- L190 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L200 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L236 `stop_redis_bridge()` (function)
- L244 `reset_for_tests()` (function)
- L250 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L254 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
