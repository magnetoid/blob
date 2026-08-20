---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/tests/test_plugins.py

Symbols in `apps/api/tests/test_plugins.py`.

- L42 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` has no DNS record, and the guard refuses names that do not
- L59 `team(client: Client)` (function)
- L66 `install(owner: Client, **overrides: object)` (function)
- L73 `bot_client(owner: Client, token: str)` (function) — A caller with a bot token and no session cookie — how an app really connects.
- L81 `test_every_event_maps_to_a_scope_that_exists()` (function)
- L87 `test_no_presence_or_typing_event_is_offered()` (function)
- L93 `test_subscribing_needs_the_matching_scope()` (function)
- L100 `test_unknown_scopes_and_events_are_refused()` (function)
- L110 `test_a_signature_verifies()` (function)
- L116 `test_a_signature_does_not_survive_a_changed_body()` (function)
- L122 `test_a_captured_request_stops_working()` (function)
- L132 `test_the_wrong_secret_does_not_verify()` (function)
- L138 `test_missing_or_unparseable_headers_are_refused(timestamp: str | None, signature: str | None)` (function)
- L145 `test_backoff_grows_and_then_gives_up()` (function)
- L152 `test_jitter_stays_inside_its_bound()` (function)
- L159 `test_installing_returns_secrets_exactly_once(team: dict)` (function)
- L171 `test_a_member_cannot_install_or_list_apps(team: dict)` (function)
- L176 `test_the_bot_is_a_real_user(team: dict)` (function)
- L200 `test_a_second_app_cannot_take_the_same_slug(team: dict)` (function)
- L207 `test_a_bot_named_after_a_person_still_installs(team: dict)` (function)
- L216 `test_installing_is_audited(team: dict)` (function)
- L237 `test_a_request_url_pointing_inward_is_refused(team: dict, url: str)` (function)
- L243 `test_a_local_plugin_cannot_be_installed_over_http(team: dict)` (function)
- L253 `test_auth_test_reports_what_the_token_can_do(team: dict)` (function)
- L263 `test_a_bad_token_gets_nowhere(team: dict, token: str)` (function)
- L271 `test_a_session_cookie_is_not_an_app_token(team: dict)` (function)
- L277 `test_an_app_must_join_a_channel_before_posting(team: dict)` (function)
- L294 `test_an_app_cannot_reach_a_private_channel_it_was_not_invited_to(team: dict)` (function)
- L311 `test_a_missing_scope_is_refused_with_a_useful_code(team: dict)` (function)
- L325 `test_an_app_retrying_a_post_does_not_double_it(team: dict)` (function)
- L338 `test_an_app_cannot_edit_someone_elses_message(team: dict)` (function)
- L351 `test_a_disabled_app_can_do_nothing(team: dict)` (function)
- L364 `test_revoking_tokens_locks_an_app_out_immediately(team: dict)` (function)
- L374 `queued(plugin_id: str)` (function)
- L385 `test_a_message_queues_a_delivery(team: dict)` (function)
- L391 `test_only_subscribed_events_are_queued(team: dict)` (function)
- L401 `test_a_disabled_app_is_not_queued_for(team: dict)` (function)
- L409 `test_a_rejected_send_queues_nothing(team: dict)` (function) — The outbox row and the message commit together, or neither does.
- L422 `test_an_app_is_not_woken_by_its_own_message(team: dict)` (function)
- L432 `test_two_apps_each_get_their_own_delivery(team: dict)` (function)
- L440 `test_deliveries_are_visible_to_an_admin(team: dict)` (function)
- L450 `test_an_update_that_widens_scopes_waits_for_approval(team: dict)` (function)
- L473 `test_an_update_that_narrows_scopes_takes_effect_at_once(team: dict)` (function)
- L490 `test_a_slug_cannot_change_after_install(team: dict)` (function)
- L499 `test_rotating_the_secret_returns_a_different_one(team: dict)` (function)
- L507 `test_uninstalling_keeps_what_the_bot_said(team: dict)` (function)
- L537 `test_uninstalling_stops_the_token(team: dict)` (function)
- L544 `test_uninstalling_is_audited(team: dict)` (function)
