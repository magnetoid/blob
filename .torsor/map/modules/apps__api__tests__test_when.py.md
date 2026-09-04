---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:51'
updated: '2026-09-04T17:42:51'
---

# apps/api/tests/test_when.py

Symbols in `apps/api/tests/test_when.py`.

- L26 `local(iso: str)` (function)
- L30 `when(phrase: str, *, timezone: str=BELGRADE)` (function)
- L34 `TestADuration` (class)
- L35 `test_minutes(self)` (method)
- L41 `test_hours_however_it_is_spelled(self, phrase: str)` (method)
- L46 `test_days_and_weeks(self)` (method)
- L50 `test_none_of_it_is_a_duration(self)` (method)
- L56 `TestAClock` (class)
- L57 `test_an_hour_still_to_come_is_today(self)` (method)
- L62 `test_an_hour_that_has_gone_is_tomorrow(self)` (method)
- L66 `test_the_meridiem_is_read(self)` (method)
- L70 `test_noon_and_midnight_are_the_awkward_ones(self)` (method)
- L76 `test_a_time_that_is_not_one(self)` (method)
- L82 `TestADay` (class)
- L83 `test_tomorrow_alone_means_the_morning(self)` (method)
- L86 `test_tomorrow_with_an_hour(self)` (method)
- L89 `test_today_only_if_it_is_still_ahead(self)` (method)
- L93 `test_a_weekday_is_the_next_one(self)` (method)
- L97 `test_and_naming_today_means_next_week(self)` (method)
- L102 `test_on_is_optional(self)` (method)
- L106 `TestARule` (class)
- L107 `test_every_day(self)` (method)
- L112 `test_every_weekday_skips_the_weekend_for_its_first_slot(self)` (method)
- L120 `test_every_week(self)` (method)
- L124 `test_a_rule_with_no_hour_is_not_read(self)` (method)
- L130 `TestTheZoneIsTheirs` (class)
- L131 `test_nine_means_nine_where_they_are(self)` (method)
- L137 `test_a_zone_that_has_gone_away_falls_back(self)` (method)
- L142 `TestTheWholeSentence` (class)
- L143 `test_the_time_at_the_end(self)` (method)
- L150 `test_the_time_at_the_start(self)` (method)
- L156 `test_me_and_to_are_stripped(self)` (method)
- L160 `test_a_rule_survives_the_sentence(self)` (method)
- L169 `test_a_time_in_the_middle_is_left_alone(self)` (method)
- L176 `test_a_sentence_with_no_time_is_refused(self)` (method)
- L179 `test_a_time_with_no_words_is_refused(self)` (method)
- L183 `test_nothing_at_all(self)` (method)
- L187 `test_the_moment_is_always_ahead(self)` (method)
