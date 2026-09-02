---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_policies.py

Symbols in `apps/api/tests/test_policies.py`.

- L50 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` is not a real host, so the SSRF guard would refuse every app.
- L61 `founder(client: Client)` (function) — The first signup: owner of the first workspace, and the server's instance admin.
- L66 `policy_of(founder: Client, workspace_id: str)` (function)
- L72 `set_policy(founder: Client, workspace_id: str, **fields: object)` (function)
- L78 `my_workspace_id(client: Client)` (function)
- L84 `TestAuthority` (class)
- L85 `test_a_workspace_admin_cannot_read_or_write_their_own_policy(self, founder: Client)` (method) — The whole reason this is not a field in `workspace_settings`.
- L105 `test_an_instance_admin_can(self, founder: Client)` (method)
- L111 `TestDefaults` (class)
- L112 `test_a_workspace_with_no_row_reads_as_the_defaults(self, founder: Client)` (method) — No row is a documented state, not a missing one.
- L124 `test_a_new_workspace_starts_closed_to_the_host(self, founder: Client)` (method)
- L135 `test_writing_one_field_leaves_the_others(self, founder: Client)` (method)
- L146 `TestTheEnvironmentIsTheCeiling` (class)
- L147 `test_policy_cannot_widen_what_the_server_forbids(self, founder: Client, monkeypatch: pytest.MonkeyPatch)` (method) — AGENT_RUNNER unset means there is no runner to deploy through.
- L169 `test_the_console_is_told_what_the_server_allows(self, founder: Client)` (method)
- L177 `TestGuards` (class)
- L178 `test_hosting_an_agent_is_refused_when_policy_says_no(self, founder: Client)` (method)
- L188 `test_a_socket_agent_is_refused_when_policy_says_no(self, founder: Client)` (method)
- L196 `test_a_denied_scope_cannot_be_installed(self, founder: Client)` (method)
- L205 `test_a_denied_scope_cannot_be_added_by_an_update(self, founder: Client)` (method)
- L217 `test_the_app_limit_stops_the_next_install_and_not_an_edit(self, founder: Client)` (method)
- L233 `test_an_unknown_scope_is_refused_rather_than_stored(self, founder: Client)` (method)
- L245 `test_one_workspace_s_policy_does_not_reach_another(founder: Client)` (function)
