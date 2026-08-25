---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/src/blob_api/realtime/hub.py

Symbols in `apps/api/src/blob_api/realtime/hub.py`.

- L38 `Connection` (class)
- L61 `send(self, event: ServerEvent)` (method) — Queue an event.
- L77 `close(self)` (method)
- L94 `new_connection(connection_id: str, user_id: str, workspace_id: str)` (function)
- L103 `register(conn: Connection)` (function)
- L108 `unregister(conn: Connection)` (function)
- L119 `set_presence_subs(conn: Connection, user_ids: list[str])` (function) — Replace what this connection watches, and keep the reverse index in step.
- L129 `subscribe_channels(conn: Connection, channel_ids: list[str])` (function)
- L137 `unsubscribe_channel(conn: Connection, channel_id: str)` (function)
- L144 `to_channel(channel_id: str, event: ServerEvent)` (function) — Everyone currently subscribed to a channel.
- L150 `to_users(user_ids: list[str], event: ServerEvent)` (function) — Every connection belonging to these users (all their devices).
- L158 `to_workspace(workspace_id: str, event: ServerEvent)` (function) — Everyone signed into one workspace — a public channel appearing, a renamed person.
- L173 `to_presence_subscribers(user_id: str, event: ServerEvent)` (function) — Presence updates go only to connections that asked about this user.
- L179 `_deliver_presence(user_id: str, event: ServerEvent)` (function)
- L184 `is_user_online(user_id: str)` (function)
- L188 `focused_channels(user_id: str)` (function) — Which channel each of a user's connections is currently focused on.
- L195 `connections_for_user(user_id: str)` (function)
- L199 `stats(workspace_id: str)` (function) — Live socket counts for one workspace.
- L214 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L235 `_publish(envelope: dict[str, Any])` (function)
- L246 `_publish_async(envelope: dict[str, Any])` (function)
- L250 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L273 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L327 `stop_redis_bridge()` (function)
- L335 `reset_for_tests()` (function)
- L342 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L346 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
