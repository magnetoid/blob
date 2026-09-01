---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:53'
updated: '2026-09-01T23:39:53'
---

# apps/api/tests/test_scheduled_messages.py

Symbols in `apps/api/tests/test_scheduled_messages.py`.

- L23 `team(client: Client)` (function)
- L31 `at(**kwargs: float)` (function)
- L35 `schedule(team: dict, *, when: str, body: str='later thing')` (function)
- L43 `bodies_in_channel(team: dict)` (function)
- L48 `make_due(scheduled_id: str)` (function) — Reach into the row rather than waiting a minute for the clock.
- L59 `TestScheduling` (class)
- L60 `test_a_scheduled_message_is_not_in_the_channel_yet(self, team: dict)` (method)
- L68 `test_a_time_in_the_past_is_refused(self, team: dict)` (method)
- L74 `test_a_time_without_a_zone_is_refused(self, team: dict)` (method)
- L83 `test_you_cannot_schedule_into_a_channel_you_are_not_in(self, team: dict)` (method)
- L96 `test_scheduled_messages_are_private_to_their_author(self, team: dict)` (method)
- L104 `TestTheSweep` (class)
- L105 `test_a_due_message_is_sent(self, team: dict)` (method)
- L114 `test_sweeping_twice_does_not_post_twice(self, team: dict)` (method)
- L127 `test_a_cancelled_message_is_never_sent(self, team: dict)` (method)
- L137 `test_leaving_the_channel_stops_it(self, team: dict)` (method)
- L154 `test_a_message_that_could_not_be_sent_says_why(self, team: dict)` (method)
- L174 `test_cancelling_someone_elses_is_not_possible(self, team: dict)` (method)
