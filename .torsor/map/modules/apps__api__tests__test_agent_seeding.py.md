---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T20:04:04'
updated: '2026-09-15T20:04:04'
---

# apps/api/tests/test_agent_seeding.py

Symbols in `apps/api/tests/test_agent_seeding.py`.

- L22 `make_workspace(admin: Client, name: str)` (function)
- L28 `owner_of(workspace_id: str)` (function)
- L40 `nothing_installed(session: AsyncSession, workspace_id: str)` (function)
- L44 `janus_running(monkeypatch: pytest.MonkeyPatch)` (function) — The one real seeder these tests borrow, for a workspace that holds a slug.
- L50 `seed_janus_into(workspace_id: str, installed_by: str)` (function)
- L56 `Seeder` (class) — A seeder that remembers every workspace it was asked about.
- L66 `__init__(self, *, fail_first: bool=False, answer: str | None='a-plugin')` (method)
- L72 `__call__(self, session: AsyncSession, workspace_id: str, *, installed_by: str)` (method)
- L85 `visited(self)` (method)
- L89 `TestOneWorkspaceCostsNoOtherItsAgent` (class)
- L90 `test_a_failure_is_skipped_and_the_rest_are_still_seeded(self, client: Client)` (method)
- L106 `test_each_workspace_is_seeded_as_its_own_owner(self, client: Client)` (method)
- L123 `test_a_workspace_with_no_owner_is_left_alone(self, client: Client)` (method)
- L142 `TestWhatIsCounted` (class)
- L143 `test_a_workspace_that_gained_nothing_is_not_counted(self, client: Client)` (method)
- L154 `test_a_workspace_that_already_had_it_is_not_counted(self, client: Client)` (method)
- L169 `TestTheSlugPrefilter` (class)
- L170 `test_the_workspace_holding_the_slug_is_skipped_and_the_others_are_not(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L194 `test_without_it_every_workspace_is_visited(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
