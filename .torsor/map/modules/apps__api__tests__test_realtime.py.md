---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/tests/test_realtime.py

Symbols in `apps/api/tests/test_realtime.py`.

- L31 `team(client: Client)` (function)
- L40 `socket_for(client: Client)` (function) — Open a WebSocket carrying the client's session cookie.
- L52 `receive_until(ws: Any, kind: str, timeout: float=3.0)` (function) — Read frames until one of `kind` arrives, ignoring the rest.
- L64 `test_the_socket_greets_and_answers_a_ping(team: dict)` (function)
- L73 `test_a_message_reaches_another_member_live(team: dict)` (function)
- L84 `test_an_edit_and_a_delete_reach_subscribers(team: dict)` (function)
- L100 `test_a_reaction_reaches_subscribers(team: dict)` (function)
- L113 `test_a_thread_reply_updates_the_summary_line(team: dict)` (function)
- L126 `test_presence_is_only_pushed_to_subscribers(team: dict)` (function)
- L137 `test_typing_reaches_the_channel(team: dict)` (function)
- L152 `test_a_private_channel_message_never_reaches_a_non_member(team: dict)` (function)
- L167 `test_presence_subscriptions_leave_nothing_behind()` (function) — The reverse presence index must empty as connections resubscribe and leave.
- L199 `test_presence_reaches_only_the_connections_watching()` (function)
- L215 `test_a_client_that_falls_behind_is_dropped_rather_than_left_silent(team: dict)` (function) — The connection has to actually go away, not just be marked gone.
- L251 `_until(predicate: Any)` (function)
- L256 `test_a_broadcast_stops_at_the_workspace_boundary()` (function) — `to_workspace` is scoped, and the scope is the point.
- L287 `TestCrossProcess` (class) — The Redis bridge carries control frames, not just events.
- L295 `test_a_relayed_subscribe_reaches_local_connections(self, team: dict)` (method)
- L312 `test_a_relayed_close_drops_the_connection(self, team: dict)` (method)
- L320 `test_subscribe_users_applies_locally_and_publishes(self, team: dict)` (method)
- L329 `TestPresenceRegistry` (class)
- L330 `test_a_sibling_processes_connection_keeps_a_user_online(self, team: dict)` (method)
- L354 `test_the_focus_registry_answers_across_processes(self, team: dict)` (method)
