---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:03:24'
updated: '2026-08-21T06:03:24'
---

# apps/api/tests/test_plugin_delivery.py

Symbols in `apps/api/tests/test_plugin_delivery.py`.

- L31 `Received` (class)
- L37 `RecordingApp` (class) — The smallest thing that can be POSTed to. Answers with whatever it is told to.
- L46 `next_status(self)` (method)
- L53 `app_server()` (function)
- L84 `make_plugin(workspace_id: str, port: int, events: list[str] | None=None)` (function) — Insert an app pointed at the recording server.
- L117 `queue(plugin_id: str, event: str='message.created', **payload: object)` (function)
- L138 `row(delivery_id: str)` (function)
- L155 `workspace(client: Client)` (function)
- L161 `test_a_delivery_arrives_signed(workspace: str, app_server: RecordingApp)` (function)
- L181 `test_a_delivery_carries_an_id_apps_can_dedupe_on(workspace: str, app_server: RecordingApp)` (function)
- L190 `test_the_wrong_secret_does_not_verify_what_we_sent(workspace: str, app_server: RecordingApp)` (function)
- L206 `test_a_success_is_recorded(workspace: str, app_server: RecordingApp)` (function)
- L218 `test_a_delivered_event_is_not_sent_twice(workspace: str, app_server: RecordingApp)` (function)
- L228 `test_a_failure_backs_off_rather_than_hammering(workspace: str, app_server: RecordingApp)` (function)
- L247 `test_410_stops_permanently(workspace: str, app_server: RecordingApp)` (function)
- L263 `test_an_unreachable_app_is_recorded_not_raised(workspace: str)` (function)
- L275 `test_a_disabled_app_keeps_its_queue_instead_of_burning_it(workspace: str, app_server: RecordingApp)` (function)
- L301 `test_events_reach_one_app_in_the_order_they_happened(workspace: str, app_server: RecordingApp)` (function)
- L316 `test_a_leased_delivery_is_not_picked_up_twice(workspace: str, app_server: RecordingApp)` (function) — Two workers draining at once must not both deliver the same event.
- L329 `test_any_2xx_counts_as_delivered(workspace: str, app_server: RecordingApp, status: int)` (function)
