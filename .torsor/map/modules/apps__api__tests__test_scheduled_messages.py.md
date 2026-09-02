---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:42:00'
updated: '2026-09-02T23:42:00'
---

# apps/api/tests/test_scheduled_messages.py

Symbols in `apps/api/tests/test_scheduled_messages.py`.

- L24 `team(client: Client)` (function)
- L32 `at(**kwargs: float)` (function)
- L36 `schedule(team: dict, *, when: str, body: str='later thing')` (function)
- L44 `bodies_in_channel(team: dict)` (function)
- L49 `make_due(scheduled_id: str)` (function) — Reach into the row rather than waiting a minute for the clock.
- L60 `TestScheduling` (class)
- L61 `test_a_scheduled_message_is_not_in_the_channel_yet(self, team: dict)` (method)
- L69 `test_a_time_in_the_past_is_refused(self, team: dict)` (method)
- L75 `test_a_time_without_a_zone_is_refused(self, team: dict)` (method)
- L84 `test_you_cannot_schedule_into_a_channel_you_are_not_in(self, team: dict)` (method)
- L97 `test_scheduled_messages_are_private_to_their_author(self, team: dict)` (method)
- L105 `TestTheSweep` (class)
- L106 `test_a_due_message_is_sent(self, team: dict)` (method)
- L115 `test_sweeping_twice_does_not_post_twice(self, team: dict)` (method)
- L128 `test_a_cancelled_message_is_never_sent(self, team: dict)` (method)
- L138 `test_leaving_the_channel_stops_it(self, team: dict)` (method)
- L155 `test_a_message_that_could_not_be_sent_says_why(self, team: dict)` (method)
- L175 `test_cancelling_someone_elses_is_not_possible(self, team: dict)` (method)
- L183 `TestASentMessageIsAlsoAnnounced` (class) — Storing the row is not sending the message.
- L198 `test_it_broadcasts_and_queues_the_same_work_a_live_send_does(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L233 `test_a_message_without_a_link_does_not_ask_for_an_unfurl(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
