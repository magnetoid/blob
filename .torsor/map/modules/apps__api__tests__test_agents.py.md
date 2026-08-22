---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T04:32:20'
updated: '2026-08-22T04:32:20'
---

# apps/api/tests/test_agents.py

Symbols in `apps/api/tests/test_agents.py`.

- L38 `StubRunner` (class) — Records what it was asked to do, so the test can assert on the call.
- L41 `__init__(self, *, fail: bool=False)` (method)
- L46 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L52 `redeploy(self, deployment_id: str)` (method)
- L55 `status(self, deployment_id: str)` (method)
- L58 `logs(self, deployment_id: str, lines: int=200)` (method)
- L61 `stop(self, deployment_id: str)` (method)
- L66 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` does not resolve, and the SSRF guard rightly refuses it.
- L77 `hosted(monkeypatch: pytest.MonkeyPatch)` (function) — Hosting configured, the runner stubbed, and the manifest served from memory.
- L95 `test_the_manifest_url_is_the_repository_raw_path()` (function)
- L105 `test_a_non_github_repository_is_refused_clearly()` (function)
- L115 `test_hosting_off_is_an_answer_not_a_crash(client: Client)` (function)
- L124 `test_a_member_cannot_deploy_an_agent(client: Client)` (function)
- L132 `test_installing_from_a_repository_deploys_it(client: Client, hosted: StubRunner)` (function)
- L157 `test_a_failed_deploy_leaves_a_retryable_install(client: Client, monkeypatch: pytest.MonkeyPatch, hosted: StubRunner)` (function)
- L174 `test_stopping_an_agent_disables_it(client: Client, hosted: StubRunner)` (function)
- L186 `test_an_app_that_is_not_hosted_here_says_so(client: Client, hosted: StubRunner)` (function)
- L206 `test_the_logs_come_back_for_a_hosted_agent(client: Client, hosted: StubRunner)` (function)
- L221 `test_a_container_manifest_cannot_be_installed_by_hand(client: Client)` (function)
- L228 `test_the_manifest_is_read_as_a_container_regardless_of_what_it_claims()` (function) — A repository does not get to say it runs in-process. ADR 0009 stands.
- L238 `test_an_agent_can_be_given_the_key_it_needs(client: Client, hosted: StubRunner)` (function) — Without this, no agent that talks to a model provider is installable at all.
- L261 `test_supplied_configuration_cannot_displace_the_agents_own_credentials(client: Client, hosted: StubRunner)` (function)
- L276 `test_an_unusable_variable_name_names_the_field(client: Client, hosted: StubRunner)` (function)
- L288 `test_installing_without_configuration_still_works(client: Client, hosted: StubRunner)` (function)
