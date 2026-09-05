---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/tests/test_agent_ownership.py

Symbols in `apps/api/tests/test_agent_ownership.py`.

- L38 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` does not resolve, and an unresolvable host reads as private.
- L52 `team(client: Client)` (function)
- L81 `may(team: dict, actor: Client, channel_id: str | None=None)` (function) — The question the run job asks before starting anything.
- L94 `give_to(team: dict, person: Client | None)` (function)
- L102 `run(client: Client, channel_id: str, body: str)` (function)
- L111 `TestAnUnownedAgentIsEverybodys` (class)
- L112 `test_anyone_can_command_it(self, team: dict)` (method)
- L120 `TestAnOwnedAgentAnswersItsOwner` (class)
- L121 `test_the_owner_can(self, team: dict)` (method)
- L125 `test_and_nobody_else(self, team: dict)` (method)
- L132 `test_handing_it_back_makes_it_everybodys_again(self, team: dict)` (method)
- L138 `TestLendingIt` (class)
- L139 `test_the_owner_lends_it_in_a_channel(self, team: dict)` (method)
- L147 `test_and_only_in_that_channel(self, team: dict)` (method)
- L156 `test_and_takes_it_back(self, team: dict)` (method)
- L165 `test_somebody_else_cannot_lend_your_agent(self, team: dict)` (method)
- L173 `test_the_workspace_agent_needs_no_lending(self, team: dict)` (method)
- L178 `test_naming_a_person_first_is_a_gentle_refusal(self, team: dict)` (method)
- L185 `test_listing_who_can(self, team: dict)` (method)
- L193 `test_lending_twice_is_not_an_error(self, team: dict)` (method)
- L204 `test_it_can_be_granted_again_after_being_taken_back(self, team: dict)` (method)
- L214 `TestOwnership` (class)
- L215 `test_only_an_admin_assigns_an_owner(self, team: dict)` (method)
- L221 `test_an_owner_has_to_be_in_the_workspace(self, team: dict)` (method)
- L228 `test_a_bot_cannot_own_an_agent(self, team: dict)` (method)
- L236 `test_the_console_can_see_who_owns_an_agent(self, team: dict)` (method) — The list is what the Owner control reads to know where it stands.
