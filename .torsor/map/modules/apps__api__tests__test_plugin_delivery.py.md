---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:44'
updated: '2026-09-04T07:26:44'
---

# apps/api/tests/test_plugin_delivery.py

Symbols in `apps/api/tests/test_plugin_delivery.py`.

- L31 `Received` (class)
- L37 `RecordingApp` (class) — The smallest thing that can be POSTed to. Answers with whatever it is told to.
- L46 `next_status(self)` (method)
- L53 `app_server()` (function)
- L84 `make_plugin(workspace_id: str, port: int, events: list[str] | None=None, *, runtime: str='external', slug: str='recorder', with_url: bool=True)` (function) — Insert an app pointed at the recording server.
- L132 `queue(plugin_id: str, event: str='message.created', **payload: object)` (function)
- L153 `row(delivery_id: str)` (function)
- L170 `workspace(client: Client)` (function)
- L176 `test_a_delivery_arrives_signed(workspace: str, app_server: RecordingApp)` (function)
- L196 `test_a_delivery_carries_an_id_apps_can_dedupe_on(workspace: str, app_server: RecordingApp)` (function)
- L205 `test_the_wrong_secret_does_not_verify_what_we_sent(workspace: str, app_server: RecordingApp)` (function)
- L221 `test_a_success_is_recorded(workspace: str, app_server: RecordingApp)` (function)
- L233 `test_a_delivered_event_is_not_sent_twice(workspace: str, app_server: RecordingApp)` (function)
- L243 `test_a_failure_backs_off_rather_than_hammering(workspace: str, app_server: RecordingApp)` (function)
- L262 `test_410_stops_permanently(workspace: str, app_server: RecordingApp)` (function)
- L278 `test_an_unreachable_app_is_recorded_not_raised(workspace: str)` (function)
- L290 `test_a_disabled_app_keeps_its_queue_instead_of_burning_it(workspace: str, app_server: RecordingApp)` (function)
- L316 `test_events_reach_one_app_in_the_order_they_happened(workspace: str, app_server: RecordingApp)` (function)
- L331 `test_a_leased_delivery_is_not_picked_up_twice(workspace: str, app_server: RecordingApp)` (function) — Two workers draining at once must not both deliver the same event.
- L344 `test_any_2xx_counts_as_delivered(workspace: str, app_server: RecordingApp, status: int)` (function)
- L355 `test_a_container_agent_receives_its_deliveries(workspace: str, app_server: RecordingApp)` (function) — The regression test for events that were queued and never leased.
- L374 `test_an_agent_without_a_url_yet_keeps_its_queue(workspace: str)` (function)
- L387 `test_a_local_plugin_is_still_never_delivered_to(workspace: str)` (function)
