---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:55'
updated: '2026-09-05T07:22:55'
---

# apps/api/tests/test_reminders.py

Symbols in `apps/api/tests/test_reminders.py`.

- L26 `owner(client: Client)` (function)
- L30 `set_zone(user_id: str, zone: str)` (function)
- L38 `make(owner: Client, args: str, *, now: datetime | None=None)` (function)
- L50 `scheduled_rows(user_id: str)` (function)
- L64 `TestSettingOne` (class)
- L65 `test_stores_the_words_and_the_moment(self, owner: Client)` (method)
- L73 `test_it_goes_to_the_conversation_with_yourself(self, owner: Client)` (method)
- L93 `test_the_dm_comes_back_only_the_first_time(self, owner: Client)` (method)
- L101 `test_and_both_land_in_the_same_one(self, owner: Client)` (method)
- L108 `test_two_identical_reminders_are_two_reminders(self, owner: Client)` (method)
- L117 `TestARepeatingOne` (class)
- L118 `test_carries_the_rule(self, owner: Client)` (method)
- L126 `test_its_first_slot_is_a_weekday(self, owner: Client)` (method)
- L136 `TestTheirOwnClock` (class)
- L137 `test_nine_means_nine_where_they_are(self, owner: Client)` (method)
- L149 `test_the_zone_is_kept_for_the_recurrence(self, owner: Client)` (method)
- L160 `TestWhenItCannotTell` (class)
- L161 `test_says_how_rather_than_guessing(self, owner: Client)` (method)
- L170 `test_a_time_with_nothing_to_say(self, owner: Client)` (method)
- L176 `test_and_nothing_at_all(self, owner: Client)` (method)
- L182 `TestItIsAnOrdinaryScheduledMessage` (class)
- L183 `test_it_shows_up_in_the_scheduled_list(self, owner: Client)` (method)
- L190 `test_and_can_be_cancelled_from_it(self, owner: Client)` (method)
- L199 `test_the_sweep_sends_it(self, owner: Client)` (method)
- L218 `TestTheCommand` (class)
- L219 `test_sets_one_and_says_so(self, owner: Client)` (method)
- L242 `test_it_does_not_take_you_anywhere(self, owner: Client)` (method)
- L262 `test_it_is_listed_in_help(self, owner: Client)` (method)
