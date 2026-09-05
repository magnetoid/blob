---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:55'
updated: '2026-09-05T07:22:55'
---

# apps/api/tests/test_my_agents.py

Symbols in `apps/api/tests/test_my_agents.py`.

- L24 `team(client: Client)` (function)
- L38 `attach(who: Client, name: str='Desktop Claude')` (function)
- L44 `plugin_row(plugin_id: str)` (function)
- L63 `TestAttaching` (class)
- L64 `test_a_member_gets_an_agent_that_is_theirs(self, team: dict)` (method)
- L79 `test_and_it_answers_only_them_from_the_first_mention(self, team: dict)` (method)
- L101 `test_two_agents_with_the_same_name_get_distinct_slugs(self, team: dict)` (method)
- L108 `test_a_name_too_short_to_slug_is_refused(self, team: dict)` (method)
- L112 `test_the_bridge_is_downloadable_by_a_member(self, team: dict)` (method)
- L118 `TestThePolicyStillApplies` (class)
- L119 `test_a_workspace_that_may_not_connect_socket_agents_refuses(self, team: dict)` (method)
- L127 `test_the_app_limit_counts_personal_agents(self, team: dict)` (method)
- L142 `TestWhoseItIs` (class)
- L143 `test_mine_lists_only_mine(self, team: dict)` (method)
- L151 `test_somebody_elses_agent_answers_404_not_403(self, team: dict)` (method)
- L163 `test_an_admin_installed_agent_is_not_mine(self, team: dict)` (method)
- L180 `test_removing_mine_retires_it(self, team: dict)` (method)
- L197 `TestWhereItGoes` (class)
- L198 `test_only_my_channels_are_offered(self, team: dict)` (method)
- L212 `test_i_can_add_it_to_a_channel_i_am_in(self, team: dict)` (method)
- L228 `test_but_not_to_one_i_am_not_in(self, team: dict)` (method)
