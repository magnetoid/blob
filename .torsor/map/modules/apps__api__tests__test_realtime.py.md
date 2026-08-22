---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T02:53:15'
updated: '2026-08-22T02:53:15'
---

# apps/api/tests/test_realtime.py

Symbols in `apps/api/tests/test_realtime.py`.

- L27 `team(client: Client)` (function)
- L36 `socket_for(client: Client)` (function) — Open a WebSocket carrying the client's session cookie.
- L48 `receive_until(ws: Any, kind: str, timeout: float=3.0)` (function) — Read frames until one of `kind` arrives, ignoring the rest.
- L60 `test_the_socket_greets_and_answers_a_ping(team: dict)` (function)
- L69 `test_a_message_reaches_another_member_live(team: dict)` (function)
- L80 `test_an_edit_and_a_delete_reach_subscribers(team: dict)` (function)
- L96 `test_a_reaction_reaches_subscribers(team: dict)` (function)
- L109 `test_a_thread_reply_updates_the_summary_line(team: dict)` (function)
- L122 `test_presence_is_only_pushed_to_subscribers(team: dict)` (function)
- L133 `test_typing_reaches_the_channel(team: dict)` (function)
- L148 `test_a_private_channel_message_never_reaches_a_non_member(team: dict)` (function)
- L163 `test_presence_subscriptions_leave_nothing_behind()` (function) — The reverse presence index must empty as connections resubscribe and leave.
- L195 `test_presence_reaches_only_the_connections_watching()` (function)
- L211 `test_a_client_that_falls_behind_is_dropped_rather_than_left_silent(team: dict)` (function) — The connection has to actually go away, not just be marked gone.
- L241 `_until(predicate: Any)` (function)
