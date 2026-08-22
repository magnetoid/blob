---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T04:12:52'
updated: '2026-08-22T04:12:52'
---

# apps/api/src/blob_api/realtime/hub.py

Symbols in `apps/api/src/blob_api/realtime/hub.py`.

- L38 `Connection` (class)
- L58 `send(self, event: ServerEvent)` (method) — Queue an event.
- L74 `close(self)` (method)
- L91 `new_connection(connection_id: str, user_id: str)` (function)
- L95 `register(conn: Connection)` (function)
- L100 `unregister(conn: Connection)` (function)
- L111 `set_presence_subs(conn: Connection, user_ids: list[str])` (function) — Replace what this connection watches, and keep the reverse index in step.
- L121 `subscribe_channels(conn: Connection, channel_ids: list[str])` (function)
- L129 `unsubscribe_channel(conn: Connection, channel_id: str)` (function)
- L136 `to_channel(channel_id: str, event: ServerEvent)` (function) — Everyone currently subscribed to a channel.
- L142 `to_users(user_ids: list[str], event: ServerEvent)` (function) — Every connection belonging to these users (all their devices).
- L150 `to_all(event: ServerEvent)` (function) — Everyone connected — used for workspace-wide facts like a profile change.
- L156 `to_presence_subscribers(user_id: str, event: ServerEvent)` (function) — Presence updates go only to connections that asked about this user.
- L162 `_deliver_presence(user_id: str, event: ServerEvent)` (function)
- L167 `is_user_online(user_id: str)` (function)
- L171 `focused_channels(user_id: str)` (function) — Which channel each of a user's connections is currently focused on.
- L178 `connections_for_user(user_id: str)` (function)
- L182 `stats()` (function)
- L190 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L209 `_publish(envelope: dict[str, Any])` (function)
- L220 `_publish_async(envelope: dict[str, Any])` (function)
- L224 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L247 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L301 `stop_redis_bridge()` (function)
- L309 `reset_for_tests()` (function)
- L316 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L320 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
