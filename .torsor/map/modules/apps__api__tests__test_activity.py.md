---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/tests/test_activity.py

Symbols in `apps/api/tests/test_activity.py`.

- L17 `team(client: Client)` (function)
- L26 `feed(who: Client, query: str='')` (function)
- L32 `_stored(user_id: str)` (function)
- L51 `_workspace_of(user_id: str)` (function)
- L63 `TestWhatLandsThere` (class)
- L64 `test_a_mention_of_you_lands_with_who_said_it(self, team: dict[str, Any])` (method)
- L72 `test_a_reaction_to_what_you_wrote_lands_with_the_emoji(self, team: dict[str, Any])` (method)
- L86 `test_your_own_words_and_your_own_reactions_are_not_activity(self, team: dict[str, Any])` (method)
- L95 `test_a_broadcast_is_a_mention_too(self, team: dict[str, Any])` (method)
- L100 `test_a_deleted_message_takes_its_activity_with_it(self, team: dict[str, Any])` (method)
- L108 `TestWhoSeesIt` (class)
- L109 `test_a_mention_in_a_channel_you_are_not_in_is_not_yours_to_see(self, team: dict[str, Any])` (method)
- L126 `test_leaving_a_channel_takes_its_activity_out_of_your_list(self, team: dict[str, Any])` (method)
- L142 `test_muting_silences_the_broadcast_and_keeps_the_direct_one(self, team: dict[str, Any])` (method)
- L157 `TestTheList` (class)
- L158 `test_it_is_newest_first_and_pages_without_repeating(self, team: dict[str, Any])` (method)
- L179 `test_two_people_reacting_to_one_message_are_two_items(self, team: dict[str, Any])` (method)
- L195 `test_it_can_be_narrowed_to_one_kind(self, team: dict[str, Any])` (method)
- L206 `test_a_kind_nobody_offers_and_a_forged_cursor_are_both_refused(self, team: dict[str, Any])` (method)
- L217 `test_an_empty_list_is_an_empty_list(self, team: dict[str, Any])` (method)
- L224 `TestStoredEvents` (class)
- L225 `test_a_direct_mention_is_written_to_the_table(self, team: dict[str, Any])` (method)
- L232 `test_a_reaction_is_written_to_the_table(self, team: dict[str, Any])` (method)
- L241 `test_a_reminder_lands_in_the_feed(self, team: dict[str, Any])` (method)
- L261 `test_your_own_mention_is_not_written(self, team: dict[str, Any])` (method)
