---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T02:22:38'
updated: '2026-09-15T02:22:38'
---

# apps/api/tests/test_janus_agent.py

Symbols in `apps/api/tests/test_janus_agent.py`.

- L26 `build(**overrides: str)` (function) — A `Settings` built from these values alone, the way test_llm_config does.
- L31 `TestSettings` (class)
- L32 `test_janus_is_off_by_default(self)` (method)
- L36 `test_the_default_name_is_janus(self)` (method)
- L39 `test_a_blank_value_reads_as_unset(self)` (method)
- L49 `janus(monkeypatch: pytest.MonkeyPatch)` (function) — The live singleton, patched the way `test_builtin_agent.py`'s `model` fixture
- L58 `TestSeeding` (class)
- L59 `test_nothing_is_seeded_when_it_is_not_running(self, client: Client)` (method)
- L64 `test_it_is_installed_with_the_manifest_scopes(self, janus: None, client: Client)` (method)
- L87 `test_the_secret_is_the_configured_one(self, janus: None, client: Client)` (method)
- L107 `test_seeding_twice_installs_once(self, janus: None, client: Client)` (method)
- L121 `test_an_existing_janus_moves_to_the_internal_url(self, janus: None, client: Client)` (method) — Production already has a `janus` row pointing at a public domain.
- L175 `TestReconcilingAtBoot` (class)
- L176 `test_every_workspace_gains_it_at_boot(self, janus: None, client: Client)` (method)
- L184 `test_reconciling_twice_seeds_nothing_the_second_time(self, janus: None, client: Client)` (method)
- L192 `TestTheUrlIsNotExemptFromTheGuardItSkips` (class)
- L193 `test_https_is_required_for_registered_urls(self, client: Client)` (method)
- L216 `test_private_hosts_are_refused_even_with_https(self, client: Client)` (method)
