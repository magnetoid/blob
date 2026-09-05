---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:55'
updated: '2026-09-05T07:22:55'
---

# apps/api/tests/test_work_channels.py

Symbols in `apps/api/tests/test_work_channels.py`.

- L58 `team(client: Client, monkeypatch: pytest.MonkeyPatch)` (function)
- L103 `speak(team: dict, *chunks: bytes)` (function)
- L119 `start(team: dict, who: Client | None=None, **overrides: Any)` (function)
- L134 `run_kickoff(team: dict)` (function) — Drive the run the kickoff message asked for, as the worker would.
- L141 `TestStarting` (class)
- L142 `test_it_spins_a_private_channel_with_the_starter_and_the_agents(self, team: dict)` (method)
- L158 `test_the_channel_says_where_it_came_from_and_the_source_links_forward(self, team: dict)` (method)
- L172 `test_the_kickoff_starts_the_agent_on_the_starters_authority(self, team: dict)` (method)
- L183 `test_the_root_authors_are_brought_along(self, team: dict)` (method)
- L192 `test_a_second_assignment_with_the_same_title_gets_its_own_channel(self, team: dict)` (method)
- L200 `test_you_cannot_start_from_a_message_you_cannot_see(self, team: dict)` (method)
- L210 `test_somebody_elses_agent_cannot_be_brought(self, team: dict)` (method)
- L228 `test_but_its_owner_can(self, team: dict)` (method)
- L237 `TestArtifacts` (class)
- L238 `test_an_agent_publishes_over_agui(self, team: dict)` (method)
- L255 `test_outside_a_work_channel_the_event_is_ignored(self, team: dict)` (method)
- L266 `test_a_person_publishes_by_hand(self, team: dict)` (method)
- L275 `test_an_app_publishes_through_the_bot_api(self, team: dict)` (method)
- L294 `test_the_kind_and_size_are_checked(self, team: dict)` (method)
- L307 `test_somebody_outside_the_channel_gets_404(self, team: dict)` (method)
- L321 `TestFinishing` (class)
- L322 `test_the_starter_finishes_it_and_the_channel_archives(self, team: dict)` (method)
- L340 `test_a_member_who_did_not_start_it_cannot_finish_it(self, team: dict)` (method)
- L349 `test_the_channel_carries_its_work_id(self, team: dict)` (method)
