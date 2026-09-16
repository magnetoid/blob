---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_work_channels.py

Symbols in `apps/api/tests/test_work_channels.py`.

- L58 `team(client: Client, monkeypatch: pytest.MonkeyPatch)` (function)
- L102 `speak(team: dict, *chunks: bytes)` (function)
- L118 `start(team: dict, who: Client | None=None, **overrides: Any)` (function)
- L133 `run_kickoff(team: dict)` (function) — Drive the run the kickoff message asked for, as the worker would.
- L140 `TestStarting` (class)
- L141 `test_it_spins_a_private_channel_with_the_starter_and_the_agents(self, team: dict)` (method)
- L157 `test_the_channel_says_where_it_came_from_and_the_source_links_forward(self, team: dict)` (method)
- L171 `test_the_kickoff_starts_the_agent_on_the_starters_authority(self, team: dict)` (method)
- L182 `test_the_root_authors_are_brought_along(self, team: dict)` (method)
- L191 `test_a_second_assignment_with_the_same_title_gets_its_own_channel(self, team: dict)` (method)
- L199 `test_you_cannot_start_from_a_message_you_cannot_see(self, team: dict)` (method)
- L209 `test_somebody_elses_agent_cannot_be_brought(self, team: dict)` (method)
- L227 `test_but_its_owner_can(self, team: dict)` (method)
- L236 `TestArtifacts` (class)
- L237 `test_an_agent_publishes_over_agui(self, team: dict)` (method)
- L254 `test_outside_a_work_channel_the_event_is_ignored(self, team: dict)` (method)
- L265 `test_a_person_publishes_by_hand(self, team: dict)` (method)
- L274 `test_an_app_publishes_through_the_bot_api(self, team: dict)` (method)
- L293 `test_the_kind_and_size_are_checked(self, team: dict)` (method)
- L306 `test_somebody_outside_the_channel_gets_404(self, team: dict)` (method)
- L320 `TestFinishing` (class)
- L321 `test_the_starter_finishes_it_and_the_channel_archives(self, team: dict)` (method)
- L339 `test_a_member_who_did_not_start_it_cannot_finish_it(self, team: dict)` (method)
- L348 `test_the_channel_carries_its_work_id(self, team: dict)` (method)
