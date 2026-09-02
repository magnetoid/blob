---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:42:00'
updated: '2026-09-02T23:42:00'
---

# apps/api/tests/test_workspaces.py

Symbols in `apps/api/tests/test_workspaces.py`.

- L25 `founder(client: Client)` (function) — The first signup: owner of the first workspace, and the server's instance admin.
- L30 `make_workspace(admin: Client, name: str)` (function)
- L37 `test_the_founder_can_create_another_workspace(founder: Client)` (function)
- L46 `test_a_new_workspace_starts_with_its_creator_and_the_default_channels(founder: Client)` (function)
- L61 `test_workspace_slugs_do_not_collide(founder: Client)` (function)
- L68 `test_only_an_instance_admin_can_create_a_workspace(founder: Client)` (function)
- L78 `test_mine_lists_every_workspace_this_person_is_in(founder: Client)` (function)
- L87 `test_a_member_of_one_workspace_sees_only_that_one(founder: Client)` (function)
- L95 `test_switching_moves_the_session_to_the_other_account(founder: Client)` (function)
- L108 `test_you_cannot_switch_into_a_workspace_you_are_not_in(founder: Client)` (function)
- L118 `test_a_workspace_cannot_read_another_ones_conversation(founder: Client)` (function)
- L134 `test_signing_in_lands_somewhere_deterministic(founder: Client)` (function) — The bug this model would otherwise hide.
- L154 `test_a_second_workspace_uses_the_password_they_already_have(founder: Client)` (function)
- L175 `test_a_new_password_reaches_every_workspace(founder: Client)` (function) — A reset writes to every row this address holds, not only the one it was minted for.
- L210 `test_the_same_display_name_is_free_in_a_different_workspace(founder: Client)` (function)
- L224 `test_the_instance_console_is_for_instance_admins(founder: Client, path: str)` (function)
