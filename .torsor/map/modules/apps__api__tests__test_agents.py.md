---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:24:31'
updated: '2026-08-21T07:24:31'
---

# apps/api/tests/test_agents.py

Symbols in `apps/api/tests/test_agents.py`.

- L38 `StubRunner` (class) — Records what it was asked to do, so the test can assert on the call.
- L41 `__init__(self, *, fail: bool=False)` (method)
- L46 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str])` (method)
- L52 `redeploy(self, deployment_id: str)` (method)
- L55 `status(self, deployment_id: str)` (method)
- L58 `stop(self, deployment_id: str)` (method)
- L63 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function) — `apps.example.com` does not resolve, and the SSRF guard rightly refuses it.
- L74 `hosted(monkeypatch: pytest.MonkeyPatch)` (function) — Hosting configured, the runner stubbed, and the manifest served from memory.
- L92 `test_the_manifest_url_is_the_repository_raw_path()` (function)
- L102 `test_a_non_github_repository_is_refused_clearly()` (function)
- L112 `test_hosting_off_is_an_answer_not_a_crash(client: Client)` (function)
- L121 `test_a_member_cannot_deploy_an_agent(client: Client)` (function)
- L129 `test_installing_from_a_repository_deploys_it(client: Client, hosted: StubRunner)` (function)
- L154 `test_a_failed_deploy_leaves_a_retryable_install(client: Client, monkeypatch: pytest.MonkeyPatch, hosted: StubRunner)` (function)
- L171 `test_stopping_an_agent_disables_it(client: Client, hosted: StubRunner)` (function)
- L183 `test_an_app_that_is_not_hosted_here_says_so(client: Client, hosted: StubRunner)` (function)
- L203 `test_a_container_manifest_cannot_be_installed_by_hand(client: Client)` (function)
- L210 `test_the_manifest_is_read_as_a_container_regardless_of_what_it_claims()` (function) — A repository does not get to say it runs in-process. ADR 0009 stands.
