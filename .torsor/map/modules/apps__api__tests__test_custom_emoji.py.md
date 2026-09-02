---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:42:00'
updated: '2026-09-02T23:42:00'
---

# apps/api/tests/test_custom_emoji.py

Symbols in `apps/api/tests/test_custom_emoji.py`.

- L24 `owner(client: Client)` (function)
- L28 `an_upload(owner: Client, mime: str='image/png')` (function) — An attachment row this workspace owns, without touching storage.
- L57 `TestAdding` (class)
- L58 `test_an_emoji_becomes_available_to_everyone(self, owner: Client)` (method)
- L71 `test_the_colons_are_optional_and_the_name_is_lowercased(self, owner: Client)` (method)
- L80 `test_a_name_no_message_could_reference_is_refused(self, owner: Client, bad: str)` (method)
- L90 `test_a_name_cannot_be_taken_twice(self, owner: Client)` (method)
- L103 `test_a_non_image_is_refused(self, owner: Client)` (method)
- L110 `test_an_upload_from_somewhere_else_is_not_available(self, owner: Client)` (method)
- L118 `test_a_member_cannot_add_one(self, owner: Client)` (method)
- L126 `TestListingAndRemoving` (class)
- L127 `test_they_are_listed_with_who_added_them(self, owner: Client)` (method)
- L135 `test_removing_one_frees_the_name(self, owner: Client)` (method)
- L148 `test_removing_one_that_is_not_there_says_so(self, owner: Client)` (method)
