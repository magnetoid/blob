---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:46:45'
updated: '2026-08-21T03:46:45'
---

# apps/api/tests/test_plugins.py

Symbols in `apps/api/tests/test_plugins.py`.

- L42 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` has no DNS record, and the guard refuses names that do not
- L59 `team(client: Client)` (function)
- L66 `install(owner: Client, **overrides: object)` (function)
- L73 `bot_client(owner: Client, token: str)` (function) — A caller with a bot token and no session cookie — how an app really connects.
- L81 `test_every_event_maps_to_a_scope_that_exists()` (function)
- L87 `test_no_presence_or_typing_event_is_offered()` (function)
- L94 `test_subscribing_needs_the_matching_scope()` (function)
- L101 `test_unknown_scopes_and_events_are_refused()` (function)
- L111 `test_a_signature_verifies()` (function)
- L117 `test_a_signature_does_not_survive_a_changed_body()` (function)
- L123 `test_a_captured_request_stops_working()` (function)
- L133 `test_the_wrong_secret_does_not_verify()` (function)
- L139 `test_missing_or_unparseable_headers_are_refused(timestamp: str | None, signature: str | None)` (function)
- L146 `test_backoff_grows_and_then_gives_up()` (function)
- L153 `test_jitter_stays_inside_its_bound()` (function)
- L160 `test_installing_returns_secrets_exactly_once(team: dict)` (function)
- L172 `test_a_member_cannot_install_or_list_apps(team: dict)` (function)
- L177 `test_the_bot_is_a_real_user(team: dict)` (function)
- L201 `test_a_second_app_cannot_take_the_same_slug(team: dict)` (function)
- L208 `test_a_bot_named_after_a_person_still_installs(team: dict)` (function)
- L217 `test_installing_is_audited(team: dict)` (function)
- L238 `test_a_request_url_pointing_inward_is_refused(team: dict, url: str)` (function)
- L244 `test_a_local_plugin_cannot_be_installed_over_http(team: dict)` (function)
- L254 `test_auth_test_reports_what_the_token_can_do(team: dict)` (function)
- L264 `test_a_bad_token_gets_nowhere(team: dict, token: str)` (function)
- L272 `test_a_session_cookie_is_not_an_app_token(team: dict)` (function)
- L278 `test_an_app_must_join_a_channel_before_posting(team: dict)` (function)
- L295 `test_an_app_cannot_reach_a_private_channel_it_was_not_invited_to(team: dict)` (function)
- L312 `test_a_missing_scope_is_refused_with_a_useful_code(team: dict)` (function)
- L326 `test_an_app_retrying_a_post_does_not_double_it(team: dict)` (function)
- L339 `test_an_app_cannot_edit_someone_elses_message(team: dict)` (function)
- L352 `test_a_disabled_app_can_do_nothing(team: dict)` (function)
- L365 `test_revoking_tokens_locks_an_app_out_immediately(team: dict)` (function)
- L375 `queued(plugin_id: str)` (function)
- L386 `test_a_message_queues_a_delivery(team: dict)` (function)
- L392 `test_only_subscribed_events_are_queued(team: dict)` (function)
- L402 `test_a_disabled_app_is_not_queued_for(team: dict)` (function)
- L410 `test_a_rejected_send_queues_nothing(team: dict)` (function) — The outbox row and the message commit together, or neither does.
- L423 `test_an_app_is_not_woken_by_its_own_message(team: dict)` (function)
- L433 `test_two_apps_each_get_their_own_delivery(team: dict)` (function)
- L441 `test_deliveries_are_visible_to_an_admin(team: dict)` (function)
- L451 `test_an_update_that_widens_scopes_waits_for_approval(team: dict)` (function)
- L474 `test_an_update_that_narrows_scopes_takes_effect_at_once(team: dict)` (function)
- L491 `test_a_slug_cannot_change_after_install(team: dict)` (function)
- L500 `test_rotating_the_secret_returns_a_different_one(team: dict)` (function)
- L508 `test_uninstalling_keeps_what_the_bot_said(team: dict)` (function)
- L538 `test_uninstalling_stops_the_token(team: dict)` (function)
- L545 `test_uninstalling_is_audited(team: dict)` (function)
