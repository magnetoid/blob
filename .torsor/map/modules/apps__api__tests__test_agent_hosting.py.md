---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/tests/test_agent_hosting.py

Symbols in `apps/api/tests/test_agent_hosting.py`.

- L48 `Runner` (class) — A runner that behaves like Coolify in the way that matters.
- L55 `__init__(self)` (method)
- L60 `deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str], port: int=3000, compose_path: str | None=None)` (method)
- L78 `redeploy(self, deployment_id: str)` (method)
- L81 `status(self, deployment_id: str)` (method)
- L85 `logs(self, deployment_id: str, lines: int=200)` (method)
- L88 `stop(self, deployment_id: str)` (method)
- L93 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L103 `hosted(monkeypatch: pytest.MonkeyPatch)` (function)
- L123 `owner_who_may_host(client: Client)` (function)
- L129 `install(owner: Client)` (function)
- L135 `urls_of(plugin_id: str)` (function)
- L146 `TestBeingAnswerable` (class)
- L147 `test_installing_gives_the_agent_an_agui_url(self, hosted: Runner, client: Client)` (method)
- L158 `test_the_webhook_url_is_still_composed_too(self, hosted: Runner, client: Client)` (method)
- L167 `test_it_does_not_wait_for_a_human_to_open_the_console(self, hosted: Runner, client: Client)` (method)
- L179 `test_an_agent_with_no_agui_path_gets_no_agui_url(self, hosted: Runner, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L201 `test_a_runner_with_no_address_yet_does_not_fail_the_install(self, hosted: Runner, client: Client)` (method)
- L213 `test_a_redeploy_keeps_the_url_it_had(self, hosted: Runner, client: Client)` (method)
- L225 `TestHowItIsBuilt` (class)
- L226 `test_a_compose_agent_names_its_compose_file(self, hosted: Runner, client: Client)` (method)
- L238 `test_the_declared_port_reaches_the_runner_and_the_agent(self, hosted: Runner, client: Client)` (method)
- L251 `TestWhatAManifestMayNotSay` (class) — A repository describes an agent. It does not get to choose what Blob connects to.
- L254 `test_a_repo_cannot_declare_its_own_agui_url(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L287 `test_an_agui_path_may_not_smuggle_a_host(self)` (method)
- L292 `test_a_relative_path_is_refused(self)` (method)
- L296 `test_an_ordinary_path_is_kept(self)` (method)
- L301 `test_an_unknown_build_pack_is_refused(self, monkeypatch: pytest.MonkeyPatch)` (method)
