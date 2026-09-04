---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:51'
updated: '2026-09-04T17:42:51'
---

# apps/api/tests/test_revocation.py

Symbols in `apps/api/tests/test_revocation.py`.

- L18 `owner(client: Client)` (function)
- L22 `invite(owner: Client, email: str, role: str='member')` (function) — Make one and hand back (token, id) — the two halves live in different answers.
- L37 `signup_with(client: Client, token: str, email: str)` (function)
- L49 `TestARevokedInvitation` (class)
- L50 `test_cannot_be_used_to_sign_up(self, owner: Client, client: Client)` (method)
- L61 `test_does_not_even_name_the_workspace(self, owner: Client, client: Client)` (method)
- L69 `test_one_that_stands_still_works(self, owner: Client, client: Client)` (method)
