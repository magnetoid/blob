---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:31'
updated: '2026-09-02T05:36:31'
---

# apps/api/tests/test_one_password.py

Symbols in `apps/api/tests/test_one_password.py`.

- L25 `two_workspaces(client: Client)` (function) — A founder who owns two workspaces, and somebody who is in the first.
- L41 `invite_from_the_second(founder: Client, email: str)` (function)
- L47 `hashes_for(email: str)` (function)
- L57 `TestJoiningASecondWorkspace` (class)
- L58 `test_the_password_they_already_have_is_the_one_that_works(self, two_workspaces: dict, client: Client)` (method)
- L78 `test_a_different_password_is_refused_rather_than_stored(self, two_workspaces: dict, client: Client)` (method)
- L99 `test_and_they_can_still_sign_in_afterwards(self, two_workspaces: dict, client: Client)` (method)
- L119 `test_a_brand_new_address_still_chooses_its_own(self, two_workspaces: dict, client: Client)` (method)
