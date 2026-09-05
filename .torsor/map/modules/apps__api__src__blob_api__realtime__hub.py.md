---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:23'
updated: '2026-09-05T04:19:23'
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
- L184 `connections_for_user(user_id: str)` (function)
- L197 `subscribe_users(user_ids: list[str], channel_ids: list[str])` (function) — Attach these users' live connections to channels — here and on every sibling.
- L202 `unsubscribe_users(user_ids: list[str], channel_ids: list[str])` (function)
- L206 `close_users(user_ids: list[str])` (function) — Drop every connection these users hold — a revocation must reach all processes.
- L211 `_control(control: dict[str, Any])` (function)
- L216 `_apply_control(control: dict[str, Any])` (function)
- L230 `stats(workspace_id: str)` (function) — Live socket counts for one workspace.
- L245 `_deliver_local(event: ServerEvent, to: dict[str, Any])` (function)
- L266 `_publish(envelope: dict[str, Any])` (function)
- L277 `_publish_async(envelope: dict[str, Any])` (function)
- L281 `_forget(task: asyncio.Task[Any])` (function) — Drop the reference and surface any error the publish raised.
- L304 `start_redis_bridge()` (function) — Re-broadcast events published by sibling processes to our local connections.
- L363 `stop_redis_bridge()` (function)
- L371 `reset_for_tests()` (function)
- L378 `_add(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
- L382 `_remove(mapping: dict[str, set[Connection]], key: str, value: Connection)` (function)
