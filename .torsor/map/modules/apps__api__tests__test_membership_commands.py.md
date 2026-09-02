---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:42:00'
updated: '2026-09-02T23:42:00'
---

# apps/api/tests/test_membership_commands.py

Symbols in `apps/api/tests/test_membership_commands.py`.

- L22 `team(client: Client)` (function)
- L37 `run(client: Client, channel_id: str, text: str)` (function)
- L46 `me(client: Client, display_name: str='Owner')` (function)
- L51 `members_of(client: Client, channel_id: str)` (function)
- L55 `TestInvite` (class)
- L56 `test_adds_the_person_named(self, team: dict)` (method)
- L64 `test_they_can_see_the_channel_afterwards(self, team: dict)` (method)
- L72 `test_a_name_nobody_has_says_so(self, team: dict)` (method)
- L77 `test_asking_twice_is_not_an_error(self, team: dict)` (method)
- L85 `test_with_nobody_named_it_says_how(self, team: dict)` (method)
- L91 `TestRemove` (class)
- L92 `test_takes_them_out(self, team: dict)` (method)
- L101 `test_someone_who_was_never_here(self, team: dict)` (method)
- L106 `test_removing_yourself_is_leaving(self, team: dict)` (method)
- L113 `TestJoin` (class)
- L114 `test_joins_by_name_and_opens_it(self, team: dict)` (method)
- L123 `test_a_channel_that_is_not_open_is_simply_absent(self, team: dict)` (method)
- L136 `test_joining_one_you_are_already_in_still_opens_it(self, team: dict)` (method)
- L141 `test_the_hash_is_optional(self, team: dict)` (method)
- L147 `TestRename` (class)
- L148 `test_renames_the_channel(self, team: dict)` (method)
- L154 `test_a_name_the_rules_refuse(self, team: dict)` (method)
- L161 `test_a_name_somebody_else_has(self, team: dict)` (method)
- L166 `test_with_no_name_it_says_how(self, team: dict)` (method)
- L172 `TestMute` (class)
- L173 `test_toggles(self, team: dict)` (method)
- L184 `test_it_is_nobody_else_s_business(self, team: dict)` (method)
- L194 `TestArchive` (class)
- L195 `test_archives(self, team: dict)` (method)
- L207 `test_a_direct_message_cannot_be(self, team: dict)` (method)
- L216 `TestWho` (class)
- L217 `test_names_the_people_here(self, team: dict)` (method)
- L225 `test_and_never_posts_it(self, team: dict)` (method)
- L236 `TestTheyAreDiscoverable` (class)
- L237 `test_help_lists_them(self, team: dict)` (method)
- L243 `test_and_so_does_the_composer_s_autocomplete(self, team: dict)` (method)
- L251 `TestDm` (class)
- L252 `test_opens_the_conversation(self, team: dict)` (method)
- L259 `test_and_says_the_thing_if_one_is_given(self, team: dict)` (method)
- L266 `test_the_message_does_not_land_in_the_channel_it_was_typed_in(self, team: dict)` (method)
- L278 `test_naming_two_people_makes_a_group(self, team: dict)` (method)
- L286 `test_opening_the_same_one_twice_is_the_same_channel(self, team: dict)` (method)
- L293 `TestStatus` (class)
- L294 `test_sets_an_emoji_and_words(self, team: dict)` (method)
- L302 `test_words_alone_are_fine(self, team: dict)` (method)
- L309 `test_clearing_it(self, team: dict)` (method)
- L319 `test_and_a_bare_slash_status_clears_it_too(self, team: dict)` (method)
- L328 `TestNamesInTheMessageAreNotInstructions` (class) — The one that mattered most in this file.
- L337 `test_dm_does_not_invite_whoever_the_message_mentions(self, team: dict)` (method)
- L351 `test_and_the_mention_stays_in_the_message(self, team: dict)` (method)
- L361 `test_remove_takes_out_only_the_people_it_names_first(self, team: dict)` (method)
- L373 `TestADirectMessageReachesBothSides` (class)
- L374 `test_the_other_person_can_see_it_at_once(self, team: dict)` (method)
- L384 `TestAGroupMessageHasACeiling` (class)
- L385 `test_the_command_and_the_route_cap_it_the_same(self)` (method)
- L397 `test_and_the_command_refuses_past_it(self, team: dict)` (method)
- L408 `TestMuteAndStatusLeaveThingsAsTheyFound` (class)
- L409 `test_unmuting_returns_to_the_default_not_the_loudest(self, team: dict)` (method)
- L422 `test_a_status_is_not_born_expired(self, team: dict)` (method)
- L435 `test_a_status_longer_than_the_dialog_allows_is_refused(self, team: dict)` (method)
