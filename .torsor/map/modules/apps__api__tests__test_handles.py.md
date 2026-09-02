---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_handles.py

Symbols in `apps/api/tests/test_handles.py`.

- L27 `owner(client: Client)` (function)
- L31 `handles_in(workspace_id: str)` (function) — handle_lower -> user_id, straight from the table.
- L48 `workspace_of(client: Client)` (function)
- L52 `join_as(owner: Client, display_name: str, email: str)` (function) — Join with a chosen address.
- L64 `TestTheInvariant` (class)
- L65 `test_every_active_person_holds_exactly_one_handle(self, owner: Client)` (method)
- L75 `test_the_name_is_lowercased_by_postgres_not_python(self, owner: Client)` (method)
- L85 `TestRenaming` (class)
- L86 `test_a_rename_moves_the_handle(self, owner: Client)` (method)
- L95 `test_taking_a_name_somebody_else_holds_is_a_conflict(self, owner: Client)` (method)
- L105 `test_a_failed_rename_changes_nothing(self, owner: Client)` (method)
- L114 `test_changing_only_the_case_of_your_own_name_works(self, owner: Client)` (method)
- L122 `test_editing_something_else_leaves_the_handle_alone(self, owner: Client)` (method)
- L130 `TestLeavingAndComingBack` (class)
- L131 `test_deactivating_frees_the_name(self, owner: Client)` (method)
- L140 `test_the_freed_name_can_be_taken(self, owner: Client)` (method)
- L147 `test_reactivating_re_claims_it(self, owner: Client)` (method)
- L155 `test_reactivating_into_a_taken_name_is_refused(self, owner: Client)` (method)
- L164 `TestSigningUp` (class)
- L165 `test_two_people_cannot_share_a_name(self, owner: Client)` (method)
- L182 `test_the_clash_ignores_case(self, owner: Client, name: str)` (method)
