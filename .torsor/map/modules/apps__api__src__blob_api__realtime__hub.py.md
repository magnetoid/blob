---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:49:12'
updated: '2026-08-21T07:49:12'
---

# apps/api/src/blob_api/realtime/hub.py

Symbols in `apps/api/src/blob_api/realtime/hub.py`.

- L34 `Connection` (class)
- L48 `send(self, event: ServerEvent)` (method) — Queue an event.
- L63 `close(self)` (method)
- L79 `new_connection(connection_id: str, user_id: str)` (function)
- L83 `register(conn: Connection)` (function)
- L88 `unregister(conn: Connection)` (function)
- L99 `set_presence_subs(conn: Connection, user_ids: list[str])` (function) — Replace what this connection watches, and keep the reverse index in step.
- L109 `subscribe_channels(conn: Connection, channel_ids: list[str])` (function)
- L117 `unsubscribe_channel(conn: Connection, channel_id: str)` (function)
- L124 `to_channel(channel_id: str, event: ServerEvent)` (function) — Everyone currently subscribed to a channel.
- L130 `to_users(user_ids: list[str], event: ServerEvent)` (function) — Every connection belonging to these users (all their devices).
- L138 `to_all(event: ServerEvent)` (function) — Everyone connected — used for workspace-wide facts like a profile change.
- L144 `to_presence_subscribers(user_id: str, event: ServerEvent)` (function) — Presence updates go only to connections that asked about this user.
- L150 `_deliver_presence(user_id: str, event: ServerEvent)` (function)
- L155 `is_user_online(user_id: str)` (function)
- L159 `focused_channels(user_id: str)` (function) — Which channel each of a user's connections is currently focused on.
- L166 `connections_for_user(user_id: str)` (function)
- L170 `stats()` (function)
- L178 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L197 `_publish(envelope: dict[str, Any])` (function)
- L208 `_publish_async(envelope: dict[str, Any])` (function)
- L212 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L222 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L256 `stop_redis_bridge()` (function)
- L264 `reset_for_tests()` (function)
- L271 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L275 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
