---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/tests/test_realtime.py

Symbols in `apps/api/tests/test_realtime.py`.

- L26 `team(client: Client)` (function)
- L35 `socket_for(client: Client)` (function) — Open a WebSocket carrying the client's session cookie.
- L47 `receive_until(ws: Any, kind: str, timeout: float=3.0)` (function) — Read frames until one of `kind` arrives, ignoring the rest.
- L59 `test_the_socket_greets_and_answers_a_ping(team: dict)` (function)
- L68 `test_a_message_reaches_another_member_live(team: dict)` (function)
- L79 `test_an_edit_and_a_delete_reach_subscribers(team: dict)` (function)
- L95 `test_a_reaction_reaches_subscribers(team: dict)` (function)
- L108 `test_a_thread_reply_updates_the_summary_line(team: dict)` (function)
- L121 `test_presence_is_only_pushed_to_subscribers(team: dict)` (function)
- L132 `test_typing_reaches_the_channel(team: dict)` (function)
- L147 `test_a_private_channel_message_never_reaches_a_non_member(team: dict)` (function)
