---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:40:02'
updated: '2026-09-16T01:40:02'
---

# apps/api/tests/test_janus_agent.py

Symbols in `apps/api/tests/test_janus_agent.py`.

- L25 `build(**overrides: str)` (function) — A `Settings` built from these values alone, the way test_llm_config does.
- L30 `TestSettings` (class)
- L31 `test_janus_is_off_by_default(self)` (method)
- L35 `test_the_default_name_is_janus(self)` (method)
- L38 `test_a_blank_value_reads_as_unset(self)` (method)
- L46 `test_a_blank_name_falls_back_to_the_default(self)` (method)
- L53 `test_manifest_does_not_raise_when_the_name_is_blank(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L68 `janus(monkeypatch: pytest.MonkeyPatch)` (function) — The live singleton, turned on for the tests that need it. `conftest.py` forces
- L76 `TestSeeding` (class)
- L77 `test_nothing_is_seeded_when_it_is_not_running(self, client: Client)` (method)
- L82 `test_it_is_installed_with_the_manifest_scopes(self, janus: None, client: Client)` (method)
- L116 `test_the_secret_is_the_configured_one(self, janus: None, client: Client)` (method)
- L136 `test_seeding_twice_installs_once(self, janus: None, client: Client)` (method)
- L146 `test_an_existing_janus_moves_to_the_internal_url(self, janus: None, client: Client)` (method) — Production already has a `janus` row pointing at a public domain.
- L197 `test_the_secret_is_reconciled_to_the_configured_one(self, janus: None, client: Client)` (method) — A workspace that already holds a Blob-minted secret has to move to the shared one.
- L251 `TestItIsInTheRoomsItIsMentionedIn` (class)
- L252 `test_the_bot_joins_the_public_channels(self, janus: None, client: Client)` (method)
- L269 `test_a_public_channel_founded_later_has_it(self, janus: None, client: Client)` (method)
- L283 `_bot_id(owner: Client)` (method)
- L288 `_found_public(owner: Client, name: str)` (method)
- L294 `_members_of(owner: Client, channel_id: str)` (method)
- L298 `_plugin_id(owner: Client)` (method)
- L302 `test_it_does_not_join_a_private_channel(self, janus: None, client: Client)` (method)
- L320 `test_a_disabled_agent_still_joins(self, janus: None, client: Client)` (method)
- L334 `test_a_retired_agent_is_not_added(self, janus: None, client: Client)` (method)
- L350 `test_an_agent_somebody_attached_for_themselves_is_not_added(self, janus: None, client: Client)` (method)
- L370 `TestTheSlugAloneIsNotIdentity` (class) — A `janus` row is not this seeder's row unless it has this seeder's shape.
- L373 `test_a_container_row_is_not_adopted(self, janus: None, client: Client)` (method)
- L417 `test_somebodys_own_agent_is_not_adopted(self, janus: None, client: Client)` (method)
- L453 `test_a_taken_slug_does_not_stop_the_boot_reconcile(self, janus: None, client: Client)` (method)
- L477 `TestReconcilingAtBoot` (class)
- L478 `test_a_workspace_that_predates_the_setting_gains_it_at_boot(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method) — Founded before anybody turned Janus on, which is every workspace on the deploy
- L499 `test_reconciling_twice_seeds_nothing_the_second_time(self, janus: None, client: Client)` (method)
- L507 `TestAWorkspaceFoundedAfterBoot` (class)
- L508 `test_signing_up_seeds_it(self, janus: None, client: Client)` (method)
- L517 `test_signing_up_seeds_nothing_when_it_is_not_running(self, client: Client)` (method)
- L526 `TestTheUrlIsNotExemptFromTheGuardItSkips` (class)
- L527 `test_https_is_required_for_registered_urls(self, client: Client)` (method)
- L550 `test_private_hosts_are_refused_even_with_https(self, client: Client)` (method)
