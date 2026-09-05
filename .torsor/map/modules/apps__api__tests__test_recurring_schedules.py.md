---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/tests/test_recurring_schedules.py

Symbols in `apps/api/tests/test_recurring_schedules.py`.

- L26 `team(client: Client)` (function)
- L33 `at(**kwargs: float)` (function)
- L37 `schedule(team: dict, *, body: str, when: str | None=None, repeat: str | None=None, timezone: str='UTC')` (function)
- L57 `bodies_in_channel(team: dict)` (function)
- L62 `waiting(team: dict)` (function)
- L66 `move_send_at(scheduled_id: str, *, ago: timedelta)` (function) — Reach into the row rather than waiting for the clock to come round.
- L75 `TestARuleIsAccepted` (class)
- L76 `test_a_known_rule_is_kept_and_read_back(self, team: dict)` (method)
- L83 `test_no_rule_at_all_is_still_the_ordinary_case(self, team: dict)` (method)
- L90 `test_a_rule_nobody_defined_is_refused(self, team: dict)` (method)
- L100 `TestItComesBack` (class)
- L101 `test_it_sends_and_stays_on_the_list(self, team: dict)` (method)
- L115 `test_a_one_off_is_gone_once_it_has_gone(self, team: dict)` (method)
- L124 `test_the_second_occurrence_is_a_second_message(self, team: dict)` (method)
- L138 `test_stopping_it_stops_it(self, team: dict)` (method)
- L152 `TestTimeThatPassed` (class)
- L153 `test_missed_occurrences_are_skipped_rather_than_sent(self, team: dict)` (method)
- L166 `test_and_only_needs_one_sweep_to_catch_up(self, team: dict)` (method)
- L179 `TestTheWallClock` (class)
- L180 `test_the_authors_zone_is_kept_with_the_row(self, team: dict)` (method)
- L195 `test_an_unknown_zone_does_not_stop_the_send(self, team: dict)` (method)
- L207 `TestAChannelThatWentReadOnly` (class)
- L208 `test_nothing_can_be_scheduled_into_an_archived_one(self, team: dict)` (method)
- L218 `test_and_a_repeating_one_stops_rather_than_posting_for_ever(self, team: dict)` (method)
- L228 `test_and_the_author_is_told_why(self, team: dict)` (method)
- L242 `test_and_can_dismiss_the_notice(self, team: dict)` (method)
