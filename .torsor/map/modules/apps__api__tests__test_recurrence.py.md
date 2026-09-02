---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/tests/test_recurrence.py

Symbols in `apps/api/tests/test_recurrence.py`.

- L24 `at(iso: str, zone: tzinfo=UTC)` (function)
- L28 `TestDaily` (class)
- L29 `test_moves_to_the_same_time_tomorrow(self)` (method)
- L33 `test_keeps_the_wall_clock_across_a_clocks_change(self)` (method)
- L45 `test_and_across_a_clocks_forward(self)` (method)
- L54 `TestWeekdays` (class)
- L55 `test_skips_the_weekend(self)` (method)
- L64 `test_moves_a_saturday_to_monday(self)` (method)
- L72 `test_an_ordinary_weekday_is_the_next_day(self)` (method)
- L77 `TestWeekly` (class)
- L78 `test_is_the_same_weekday_seven_days_on(self)` (method)
- L86 `test_crosses_a_month_without_help(self)` (method)
- L91 `TestAlways` (class)
- L93 `test_lands_strictly_after_the_occurrence_it_follows(self, repeat: str)` (method)
- L101 `test_a_rule_nobody_defined_names_no_occurrence(self)` (method)
- L105 `test_a_zone_that_has_gone_away_does_not_stop_the_sweep(self)` (method)
- L113 `TestHowItReads` (class)
- L114 `test_names_each_rule_in_words(self)` (method)
