---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T05:53:40'
updated: '2026-09-06T05:53:40'
---

# apps/api/tests/test_activity.py

Symbols in `apps/api/tests/test_activity.py`.

- L13 `team(client: Client)` (function)
- L22 `feed(who: Client, query: str='')` (function)
- L28 `TestWhatLandsThere` (class)
- L29 `test_a_mention_of_you_lands_with_who_said_it(self, team: dict[str, Any])` (method)
- L37 `test_a_reaction_to_what_you_wrote_lands_with_the_emoji(self, team: dict[str, Any])` (method)
- L51 `test_your_own_words_and_your_own_reactions_are_not_activity(self, team: dict[str, Any])` (method)
- L60 `test_a_broadcast_is_a_mention_too(self, team: dict[str, Any])` (method)
- L65 `test_a_deleted_message_takes_its_activity_with_it(self, team: dict[str, Any])` (method)
- L73 `TestWhoSeesIt` (class)
- L74 `test_a_mention_in_a_channel_you_are_not_in_is_not_yours_to_see(self, team: dict[str, Any])` (method)
- L91 `test_leaving_a_channel_takes_its_activity_out_of_your_list(self, team: dict[str, Any])` (method)
- L107 `test_muting_silences_the_broadcast_and_keeps_the_direct_one(self, team: dict[str, Any])` (method)
- L122 `TestTheList` (class)
- L123 `test_it_is_newest_first_and_pages_without_repeating(self, team: dict[str, Any])` (method)
- L144 `test_two_people_reacting_to_one_message_are_two_items(self, team: dict[str, Any])` (method)
- L160 `test_it_can_be_narrowed_to_one_kind(self, team: dict[str, Any])` (method)
- L171 `test_a_kind_nobody_offers_and_a_forged_cursor_are_both_refused(self, team: dict[str, Any])` (method)
- L182 `test_an_empty_list_is_an_empty_list(self, team: dict[str, Any])` (method)
