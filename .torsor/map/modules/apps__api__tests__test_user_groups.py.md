---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_user_groups.py

Symbols in `apps/api/tests/test_user_groups.py`.

- L30 `team(client: Client)` (function)
- L46 `a_bot(workspace_id: str)` (function) — A bot user, written straight in.
- L69 `make_group(owner: Client, handle: str='platform-team', **extra: object)` (function)
- L76 `TestTheNamespace` (class)
- L77 `test_a_group_cannot_take_a_persons_name(self, team: dict)` (method)
- L84 `test_a_person_cannot_rename_onto_a_group_handle(self, team: dict)` (method)
- L91 `test_reactivating_a_person_whose_name_became_a_group_is_refused(self, team: dict)` (method)
- L104 `test_a_deactivated_persons_name_is_free_for_a_group(self, team: dict)` (method)
- L110 `test_two_groups_cannot_share_a_handle(self, team: dict)` (method)
- L120 `test_a_handle_no_message_could_reference_is_refused(self, team: dict, handle: str)` (method)
- L129 `test_capitals_are_normalised_rather_than_refused(self, team: dict)` (method)
- L138 `test_the_leading_at_somebody_types_is_forgiven(self, team: dict)` (method)
- L146 `TestResolution` (class)
- L147 `test_a_handle_resolves_to_a_group_not_a_person(self, team: dict)` (method)
- L161 `test_a_message_stores_the_group_it_named(self, team: dict)` (method)
- L168 `test_a_person_and_a_group_in_one_message_land_in_different_places(self, team: dict)` (method)
- L179 `test_a_group_named_inside_code_mentions_nobody(self, team: dict)` (method)
- L187 `TestTheMentionIsNotRewritten` (class)
- L188 `test_editing_a_message_does_not_change_who_it_mentioned(self, team: dict)` (method) — The single most valuable test here.
- L212 `test_deleting_a_message_forgets_the_group_it_named(self, team: dict)` (method)
- L229 `TestWhoGetsTold` (class)
- L230 `test_a_group_mention_reaches_its_members(self, team: dict)` (method)
- L238 `test_it_counts_as_a_mention_but_is_labelled_a_group(self, team: dict)` (method)
- L255 `test_being_named_personally_outranks_being_named_by_group(self)` (method)
- L271 `test_a_muted_group_is_silent(self, team: dict)` (method)
- L281 `test_muting_a_group_is_not_muting_the_channel(self)` (method)
- L301 `test_a_member_outside_the_channel_is_never_considered(self)` (method)
- L322 `TestMembership` (class)
- L323 `test_adding_somebody_twice_adds_them_once(self, team: dict)` (method)
- L334 `test_a_bot_cannot_be_put_in_a_group(self, team: dict)` (method) — The privilege-inversion guard.
- L350 `test_removing_somebody_takes_them_out(self, team: dict)` (method)
- L362 `test_muting_a_group_you_are_not_in_says_nothing_about_it(self, team: dict)` (method)
- L370 `TestWhoMayManage` (class)
- L371 `test_a_member_cannot_create_one(self, team: dict)` (method)
- L377 `test_a_member_cannot_add_people(self, team: dict)` (method)
- L384 `test_a_group_from_another_workspace_does_not_exist(self, team: dict)` (method)
- L402 `TestRenaming` (class)
- L403 `test_the_handle_moves_with_it(self, team: dict)` (method)
- L415 `test_renaming_onto_a_taken_handle_is_refused(self, team: dict)` (method)
- L424 `test_deleting_a_group_frees_its_handle(self, team: dict)` (method)
