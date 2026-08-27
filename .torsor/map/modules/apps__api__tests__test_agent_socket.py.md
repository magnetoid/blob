---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:18'
updated: '2026-08-27T03:38:18'
---

# apps/api/tests/test_agent_socket.py

Symbols in `apps/api/tests/test_agent_socket.py`.

- L52 `_no_leaked_connections()` (function) — Make sure a test's agent connections are gone before the next one starts.
- L70 `team(client: Client)` (function)
- L77 `install(owner: Client, **overrides: object)` (function)
- L83 `join_channel(owner: Client, app_body: dict, channel_id: str)` (function)
- L92 `agent_socket(token: str | None=None)` (function) — Connect as an agent. With a token, authenticates by header; without, stays mute.
- L102 `_flatten(error: BaseException)` (function) — Every leaf in a possibly-nested exception group.
- L109 `refused_with(token: str)` (function) — Connect as an agent that should be turned away, and report the close code.
- L131 `receive_until(ws: Any, kind: str, timeout: float=5.0)` (function)
- L141 `messages_in(channel_id: str)` (function)
- L152 `agui_event(**event: Any)` (function)
- L166 `TestRegistration` (class)
- L167 `test_a_socket_agent_needs_no_url(self, team: dict)` (method)
- L175 `test_declaring_a_url_is_refused(self, team: dict)` (method)
- L185 `TestAuth` (class)
- L186 `test_the_bot_token_in_a_header_is_accepted(self, team: dict)` (method)
- L193 `test_a_first_frame_works_for_a_client_that_cannot_set_headers(self, team: dict)` (method)
- L202 `test_a_bad_token_is_refused(self, team: dict)` (method)
- L206 `test_a_disabled_agent_cannot_hold_a_connection(self, team: dict)` (method)
- L219 `TestHello` (class)
- L220 `test_connecting_is_how_an_agent_says_what_it_is(self, team: dict)` (method)
- L244 `test_an_agent_cannot_grant_itself_a_scope(self, team: dict)` (method) — The consent screen has to mean something.
- L264 `test_a_field_left_out_keeps_what_was_there(self, team: dict)` (method)
- L280 `TestPresence` (class)
- L281 `test_online_only_while_the_socket_is_held(self, team: dict)` (method)
- L300 `TestRunRouting` (class)
- L301 `test_a_mention_reaches_the_agent_and_its_answer_lands(self, team: dict)` (method)
- L326 `test_an_agent_that_is_not_connected_says_so(self, team: dict)` (method)
- L338 `test_a_run_reaching_two_holders_is_answered_once(self, team: dict)` (method) — Pub/sub is fan-out, and an agent can be connected twice mid-reconnect.
- L373 `TestStreamEvents` (class)
- L374 `test_subscribing_happens_before_publishing(self, team: dict)` (method) — The race that makes a working agent look like a hanging one.
