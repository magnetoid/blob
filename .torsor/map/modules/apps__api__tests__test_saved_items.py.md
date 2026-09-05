---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/tests/test_saved_items.py

Symbols in `apps/api/tests/test_saved_items.py`.

- L21 `team(client: Client)` (function)
- L29 `a_message(team: dict, body: str='worth keeping')` (function)
- L35 `saved_bodies(client: Client)` (function)
- L41 `TestSaving` (class)
- L42 `test_a_saved_message_comes_back(self, team: dict)` (method)
- L49 `test_saving_twice_saves_once(self, team: dict)` (method)
- L59 `test_unsaving_removes_it_and_is_also_idempotent(self, team: dict)` (method)
- L69 `test_the_newest_save_is_first(self, team: dict)` (method)
- L79 `test_a_message_that_is_gone_cannot_be_saved(self, team: dict)` (method)
- L86 `test_a_deleted_message_drops_out_of_the_list(self, team: dict)` (method)
- L95 `TestItIsYours` (class)
- L96 `test_saving_is_invisible_to_everybody_else(self, team: dict)` (method)
- L106 `test_two_people_can_save_the_same_message(self, team: dict)` (method)
- L116 `test_unsaving_touches_only_your_own(self, team: dict)` (method)
- L126 `TestAccess` (class)
- L127 `test_a_channel_you_are_not_in_cannot_be_saved_from(self, team: dict)` (method)
- L139 `test_leaving_a_channel_takes_its_messages(self, team: dict)` (method)
- L157 `TestBootPayload` (class)
- L158 `test_the_ids_ride_along_so_the_menu_can_label_itself(self, team: dict)` (method)
- L168 `test_it_is_empty_for_somebody_who_saved_nothing(self, team: dict, saved: bool)` (method)
