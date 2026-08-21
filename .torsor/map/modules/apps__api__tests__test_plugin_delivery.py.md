---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T22:18:48'
updated: '2026-08-21T22:18:48'
---

# apps/api/tests/test_plugin_delivery.py

Symbols in `apps/api/tests/test_plugin_delivery.py`.

- L32 `Received` (class)
- L38 `RecordingApp` (class) — The smallest thing that can be POSTed to. Answers with whatever it is told to.
- L47 `next_status(self)` (method)
- L54 `app_server()` (function)
- L85 `make_plugin(workspace_id: str, port: int, events: list[str] | None=None, *, runtime: str='external', slug: str='recorder', with_url: bool=True)` (function) — Insert an app pointed at the recording server.
- L133 `queue(plugin_id: str, event: str='message.created', **payload: object)` (function)
- L154 `row(delivery_id: str)` (function)
- L171 `workspace(client: Client)` (function)
- L177 `test_a_delivery_arrives_signed(workspace: str, app_server: RecordingApp)` (function)
- L197 `test_a_delivery_carries_an_id_apps_can_dedupe_on(workspace: str, app_server: RecordingApp)` (function)
- L206 `test_the_wrong_secret_does_not_verify_what_we_sent(workspace: str, app_server: RecordingApp)` (function)
- L222 `test_a_success_is_recorded(workspace: str, app_server: RecordingApp)` (function)
- L234 `test_a_delivered_event_is_not_sent_twice(workspace: str, app_server: RecordingApp)` (function)
- L244 `test_a_failure_backs_off_rather_than_hammering(workspace: str, app_server: RecordingApp)` (function)
- L263 `test_410_stops_permanently(workspace: str, app_server: RecordingApp)` (function)
- L279 `test_an_unreachable_app_is_recorded_not_raised(workspace: str)` (function)
- L291 `test_a_disabled_app_keeps_its_queue_instead_of_burning_it(workspace: str, app_server: RecordingApp)` (function)
- L317 `test_events_reach_one_app_in_the_order_they_happened(workspace: str, app_server: RecordingApp)` (function)
- L332 `test_a_leased_delivery_is_not_picked_up_twice(workspace: str, app_server: RecordingApp)` (function) — Two workers draining at once must not both deliver the same event.
- L345 `test_any_2xx_counts_as_delivered(workspace: str, app_server: RecordingApp, status: int)` (function)
- L356 `test_a_container_agent_receives_its_deliveries(workspace: str, app_server: RecordingApp)` (function) — The regression test for events that were queued and never leased.
- L375 `test_an_agent_without_a_url_yet_keeps_its_queue(workspace: str)` (function)
- L388 `test_a_local_plugin_is_still_never_delivered_to(workspace: str)` (function)
- L395 `test_has_subscribers_agrees_with_the_drain_about_container_agents(workspace: str, app_server: RecordingApp)` (function) — A shortcut that disagrees with the queue is worse than no shortcut.
