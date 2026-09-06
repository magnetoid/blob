---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:22:00'
updated: '2026-09-06T18:22:00'
---

# apps/api/tests/test_mcp.py

Symbols in `apps/api/tests/test_mcp.py`.

- L30 `socket_for(client: Client)` (function) — A live socket carrying that person's session — the room, watching.
- L41 `receive_until(ws: Any, kind: str, timeout: float=3.0)` (function)
- L57 `Mcp` (class) — A client speaking one era of the protocol, with a token and no cookies.
- L60 `__init__(self, client: Client, token: str, era: str=LEGACY)` (method)
- L65 `raw(self, body: dict[str, Any], headers: dict[str, str] | None=None)` (method)
- L68 `send(self, method: str, params: dict[str, Any] | None=None)` (method)
- L82 `call(self, name: str, arguments: dict[str, Any] | None=None)` (method)
- L89 `refuse(self, name: str, arguments: dict[str, Any] | None=None)` (method) — A tool that says no. `isError`, not a JSON-RPC error — the connection is fine.
- L98 `mint(client: Client, name: str='Claude Code', *, can_write: bool=False)` (function)
- L105 `team(client: Client)` (function)
- L128 `TestTheTokenItself` (class)
- L129 `test_the_secret_is_shown_once_and_never_stored(self, team: dict[str, Any])` (method)
- L141 `test_the_url_is_what_you_paste_into_an_assistant(self, team: dict[str, Any])` (method)
- L146 `test_write_is_a_separate_decision(self, team: dict[str, Any])` (method)
- L153 `test_a_revoked_token_stops_working_immediately(self, team: dict[str, Any])` (method)
- L166 `test_somebody_else_cannot_revoke_your_connection(self, team: dict[str, Any])` (method)
- L173 `test_you_only_see_your_own(self, team: dict[str, Any])` (method)
- L179 `test_minting_is_audited(self, team: dict[str, Any])` (method)
- L184 `test_the_endpoint_needs_a_token(self, team: dict[str, Any])` (method)
- L193 `test_minting_still_needs_a_session(self, team: dict[str, Any])` (method) — `/api/mcp` is public; the routes that mint credentials must not be.
- L203 `TestLegacyClients` (class)
- L204 `test_initialize_agrees_on_the_version_it_was_asked_for(self, team: dict[str, Any])` (method)
- L221 `test_a_version_we_do_not_speak_is_answered_with_one_we_do(self, team: dict[str, Any])` (method)
- L228 `test_the_initialized_notification_is_accepted_and_silent(self, team: dict[str, Any])` (method)
- L239 `test_ping_answers(self, team: dict[str, Any])` (method)
- L244 `test_an_unknown_method_is_a_method_not_found(self, team: dict[str, Any])` (method)
- L250 `TestModernClients` (class)
- L251 `test_no_handshake_is_needed_at_all(self, team: dict[str, Any])` (method)
- L257 `test_discover_names_every_version_we_speak(self, team: dict[str, Any])` (method)
- L264 `test_a_header_that_disagrees_with_the_body_is_refused(self, team: dict[str, Any])` (method) — The whole point of mirroring: a proxy and the server cannot be made to differ.
- L289 `test_a_missing_method_header_is_refused(self, team: dict[str, Any])` (method)
- L303 `test_a_base64_wrapped_name_header_still_matches(self, team: dict[str, Any])` (method)
- L328 `test_an_unknown_modern_method_is_a_404_with_a_json_rpc_body(self, team: dict[str, Any])` (method) — What tells a client "modern server, wrong method" from "wrong endpoint".
- L337 `test_the_get_stream_and_delete_session_are_gone(self, team: dict[str, Any])` (method)
- L348 `talking(team: dict[str, Any])` (function)
- L358 `TestReading` (class)
- L359 `test_whoami_says_who_and_what_it_may_do(self, talking: dict[str, Any])` (method)
- L368 `test_a_read_only_token_is_not_even_offered_the_write_tool(self, talking: dict[str, Any])` (method)
- L378 `test_a_writing_token_is(self, talking: dict[str, Any])` (method)
- L383 `test_list_channels_shows_what_this_person_can_see(self, talking: dict[str, Any])` (method)
- L394 `test_read_channel_reads_oldest_first_and_carries_ids(self, talking: dict[str, Any])` (method)
- L403 `test_a_private_channel_is_a_refusal_not_a_leak(self, talking: dict[str, Any])` (method)
- L412 `test_read_thread_gives_the_root_once(self, talking: dict[str, Any])` (method)
- L419 `test_a_thread_in_a_channel_you_cannot_see_is_refused(self, talking: dict[str, Any])` (method)
- L427 `test_search_finds_what_you_can_see_and_no_more(self, talking: dict[str, Any])` (method)
- L434 `test_search_takes_the_same_modifiers_the_app_does(self, talking: dict[str, Any])` (method)
- L441 `test_a_name_that_matches_nobody_is_said_out_loud(self, talking: dict[str, Any])` (method) — Not an empty result: an assistant cannot tell that from a quiet workspace.
- L450 `test_filters_with_nothing_to_search_for_are_refused(self, talking: dict[str, Any])` (method)
- L456 `test_list_people_gives_the_names_a_message_can_at(self, talking: dict[str, Any])` (method)
- L463 `test_a_limit_is_capped_rather_than_obeyed(self, talking: dict[str, Any])` (method)
- L468 `test_an_id_a_model_invented_is_told_so_rather_than_crashing(self, talking: dict[str, Any])` (method) — A model hands back ids it read; sometimes it hands back something else.
- L487 `test_an_unknown_tool_is_a_protocol_error(self, talking: dict[str, Any])` (method)
- L493 `TestWriting` (class)
- L494 `test_a_post_lands_as_the_person_and_is_broadcast(self, talking: dict[str, Any])` (method)
- L511 `test_a_reply_goes_into_the_thread(self, talking: dict[str, Any])` (method)
- L524 `test_a_read_only_token_cannot_post(self, talking: dict[str, Any])` (method)
- L533 `test_posting_where_you_are_not_a_member_is_refused(self, talking: dict[str, Any])` (method)
- L544 `test_the_room_sees_it_live(self, talking: dict[str, Any])` (method) — The half a stored row does not buy: `announce` past COMMIT, or nobody is told.
- L556 `test_a_mention_raises_the_badge(self, talking: dict[str, Any])` (method)
- L570 `test_posting_into_an_archived_channel_is_refused(self, talking: dict[str, Any])` (method)
- L580 `TestTheTokenIsThePerson` (class)
- L581 `test_deactivating_somebody_silences_their_assistant(self, talking: dict[str, Any])` (method)
- L595 `test_leaving_a_channel_takes_the_assistant_with_you(self, talking: dict[str, Any])` (method)
- L604 `test_an_assistant_in_a_loop_is_stopped(self, talking: dict[str, Any])` (method) — Keyed by the person, so a second connection buys no second allowance.
- L619 `test_last_used_is_recorded(self, talking: dict[str, Any])` (method)
- L626 `TestBadInput` (class)
- L628 `test_rubbish_is_a_json_rpc_error_not_a_stack_trace(self, team: dict[str, Any], body: str)` (method)
- L639 `test_a_message_with_no_method_is_refused(self, team: dict[str, Any])` (method)
