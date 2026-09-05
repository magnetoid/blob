---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/tests/test_agent_shell.py

Symbols in `apps/api/tests/test_agent_shell.py`.

- L34 `TestClampSize` (class)
- L35 `test_garbage_becomes_the_default(self)` (method)
- L39 `test_out_of_range_is_pinned_not_refused(self)` (method)
- L46 `test_a_reasonable_window_passes_through(self)` (method)
- L51 `_fresh_key_text()` (function)
- L55 `TestClientKey` (class)
- L56 `test_a_key_with_real_newlines_is_read(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L60 `test_a_key_with_escaped_newlines_is_read(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L67 `test_missing_reads_as_disabled(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L73 `test_garbage_is_a_config_error_not_a_request_error(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L83 `TestKnownHosts` (class)
- L84 `test_a_bare_type_key_pair_gets_the_host_prepended(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L93 `test_a_nondefault_port_uses_the_bracket_form(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L103 `test_missing_reads_as_disabled(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L110 `TestCurrentShell` (class)
- L111 `test_off_is_a_normal_state_with_a_name(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L117 `test_partially_configured_is_still_off(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L132 `_enable_shell(monkeypatch: pytest.MonkeyPatch)` (function)
- L143 `_actor_for(owner: Client)` (function)
- L147 `TestResolve` (class)
- L148 `test_a_hosted_agent_resolves_to_its_deployment(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L162 `test_an_unhosted_agent_has_no_terminal(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L181 `test_the_hosting_policy_gates_the_terminal_too(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L199 `test_an_unconfigured_server_answers_before_touching_the_database(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L216 `_FakeSession` (class)
- L219 `read(self)` (method)
- L222 `write(self, data: bytes)` (method)
- L224 `resize(self, cols: int, rows: int)` (method)
- L226 `close(self)` (method)
- L229 `_FakeShell` (class)
- L230 `open(self, deployment_id: str, *, cols: int, rows: int)` (method)
- L234 `_RefusingShell` (class)
- L235 `open(self, deployment_id: str, *, cols: int, rows: int)` (method)
- L239 `_audit_actions(workspace_id: str)` (function)
- L256 `TestAuditBracket` (class)
- L257 `test_open_and_close_are_both_recorded(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L279 `test_a_session_that_never_opens_still_leaves_its_record(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L302 `TestResolveFromADm` (class) — `/cli` names the agent by who the conversation is with, not by plugin id.
- L310 `test_a_bot_user_resolves_to_the_agent_behind_it(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L333 `test_a_person_is_not_an_agent(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L348 `test_an_unhosted_agent_still_has_no_terminal_from_a_dm(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
- L377 `test_an_agent_in_another_workspace_is_not_found(self, client: Client, hosted: Runner, monkeypatch: pytest.MonkeyPatch)` (method)
