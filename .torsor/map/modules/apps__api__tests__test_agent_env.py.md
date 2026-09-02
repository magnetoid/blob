---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_agent_env.py

Symbols in `apps/api/tests/test_agent_env.py`.

- L44 `Runner` (class) — An environment store with the runner's actual semantics: append, never upsert.
- L47 `__init__(self)` (method)
- L52 `add(self, key: str, value: str, *, managed: bool=False)` (method)
- L58 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=3000, compose_path: str | None=None)` (method)
- L72 `redeploy(self, deployment_id: str)` (method)
- L75 `status(self, deployment_id: str)` (method)
- L78 `logs(self, deployment_id: str, lines: int=200)` (method)
- L81 `stop(self, deployment_id: str)` (method)
- L84 `env(self, deployment_id: str)` (method)
- L87 `set_env(self, deployment_id: str, key: str, value: str)` (method)
- L93 `unset_env(self, deployment_id: str, key: str)` (method)
- L98 `values_of(self, key: str)` (method)
- L103 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L113 `hosted(monkeypatch: pytest.MonkeyPatch)` (function)
- L131 `install(client: Client)` (function)
- L142 `TestWriting` (class)
- L143 `test_setting_a_key_twice_leaves_one_row(self, hosted: Runner, client: Client)` (method)
- L154 `test_it_repairs_duplicates_that_were_already_there(self, hosted: Runner, client: Client)` (method)
- L170 `test_removing_a_key_removes_every_row_of_it(self, hosted: Runner, client: Client)` (method)
- L181 `test_saving_can_restart_the_agent(self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L203 `test_it_does_not_restart_unless_asked(self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L218 `TestWhatIsShown` (class)
- L219 `test_a_secret_is_described_rather_than_printed(self, hosted: Runner, client: Client)` (method)
- L233 `test_an_ordinary_value_is_shown(self, hosted: Runner, client: Client)` (method)
- L243 `test_a_duplicated_key_is_flagged(self, hosted: Runner, client: Client)` (method)
- L254 `test_the_runners_own_values_are_marked_managed(self, hosted: Runner, client: Client)` (method)
- L267 `TestWhatBlobKeepsForItself` (class)
- L268 `test_a_reserved_key_cannot_be_set(self, hosted: Runner, client: Client)` (method)
- L278 `test_a_reserved_key_cannot_be_removed(self, hosted: Runner, client: Client)` (method)
- L290 `test_the_port_is_reserved_too(self, hosted: Runner, client: Client)` (method)
- L300 `test_the_port_cannot_be_removed_either(self, hosted: Runner, client: Client)` (method)
- L317 `test_the_reserved_names_are_listed(self, hosted: Runner, client: Client)` (method)
- L328 `TestAuthorization` (class)
- L329 `test_a_member_cannot_read_configuration(self, hosted: Runner, client: Client)` (method)
- L337 `test_a_member_cannot_write_it(self, hosted: Runner, client: Client)` (method)
