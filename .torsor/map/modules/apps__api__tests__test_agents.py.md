---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:43'
updated: '2026-09-04T07:26:43'
---

# apps/api/tests/test_agents.py

Symbols in `apps/api/tests/test_agents.py`.

- L38 `StubRunner` (class) — Records what it was asked to do, so the test can assert on the call.
- L41 `__init__(self, *, fail: bool=False)` (method)
- L47 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=3000, compose_path: str | None=None)` (method)
- L72 `redeploy(self, deployment_id: str)` (method)
- L75 `status(self, deployment_id: str)` (method)
- L78 `logs(self, deployment_id: str, lines: int=200)` (method)
- L81 `stop(self, deployment_id: str)` (method)
- L84 `env_of(self, deployment_id: str)` (method)
- L89 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` does not resolve, and the SSRF guard rightly refuses it.
- L100 `hosted(monkeypatch: pytest.MonkeyPatch)` (function) — Hosting configured, the runner stubbed, and the manifest served from memory.
- L118 `hosting_owner(client: Client)` (function) — An owner whose workspace is allowed to deploy agents onto this machine.
- L131 `test_the_manifest_url_is_the_repository_raw_path()` (function)
- L141 `test_a_non_github_repository_is_refused_clearly()` (function)
- L151 `test_hosting_off_is_an_answer_not_a_crash(client: Client)` (function)
- L160 `test_a_member_cannot_deploy_an_agent(client: Client)` (function)
- L168 `test_installing_from_a_repository_deploys_it(client: Client, hosted: StubRunner)` (function)
- L193 `test_a_failed_deploy_leaves_a_retryable_install(client: Client, monkeypatch: pytest.MonkeyPatch, hosted: StubRunner)` (function)
- L210 `test_stopping_an_agent_disables_it(client: Client, hosted: StubRunner)` (function)
- L222 `test_an_app_that_is_not_hosted_here_says_so(client: Client, hosted: StubRunner)` (function)
- L240 `test_the_logs_come_back_for_a_hosted_agent(client: Client, hosted: StubRunner)` (function)
- L255 `test_a_container_manifest_cannot_be_installed_by_hand(client: Client)` (function)
- L262 `test_the_manifest_is_read_as_a_container_regardless_of_what_it_claims()` (function) — A repository does not get to say it runs in-process. ADR 0009 stands.
- L272 `test_an_agent_can_be_given_the_key_it_needs(client: Client, hosted: StubRunner)` (function) — Without this, no agent that talks to a model provider is installable at all.
- L293 `test_supplied_configuration_cannot_displace_the_agents_own_credentials(client: Client, hosted: StubRunner)` (function)
- L308 `test_an_unusable_variable_name_names_the_field(client: Client, hosted: StubRunner)` (function)
- L320 `test_installing_without_configuration_still_works(client: Client, hosted: StubRunner)` (function)
