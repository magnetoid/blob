---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_janus_agent.py

Symbols in `apps/api/tests/test_janus_agent.py`.

- L26 `build(**overrides: str)` (function) — A `Settings` built from these values alone, the way test_llm_config does.
- L31 `TestSettings` (class)
- L32 `test_janus_is_off_by_default(self)` (method)
- L36 `test_the_default_name_is_janus(self)` (method)
- L39 `test_a_blank_value_reads_as_unset(self)` (method)
- L47 `test_a_blank_name_falls_back_to_the_default(self)` (method)
- L54 `test_manifest_does_not_raise_when_the_name_is_blank(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L69 `janus(monkeypatch: pytest.MonkeyPatch)` (function) — The live singleton, turned on for the tests that need it. `conftest.py` forces
- L77 `TestSeeding` (class)
- L78 `test_nothing_is_seeded_when_it_is_not_running(self, client: Client)` (method)
- L83 `test_it_is_installed_with_the_manifest_scopes(self, janus: None, client: Client)` (method)
- L117 `test_the_secret_is_the_configured_one(self, janus: None, client: Client)` (method)
- L137 `test_seeding_twice_installs_once(self, janus: None, client: Client)` (method)
- L147 `test_an_existing_janus_moves_to_the_internal_url(self, janus: None, client: Client)` (method) — Production already has a `janus` row pointing at a public domain.
- L198 `test_the_secret_is_reconciled_to_the_configured_one(self, janus: None, client: Client)` (method) — A workspace that already holds a Blob-minted secret has to move to the shared one.
- L252 `TestItIsInTheRoomsItIsMentionedIn` (class)
- L253 `test_the_bot_joins_the_public_channels(self, janus: None, client: Client)` (method)
- L270 `test_a_public_channel_founded_later_has_it(self, janus: None, client: Client)` (method)
- L284 `_bot_id(owner: Client)` (method)
- L289 `_found_public(owner: Client, name: str)` (method)
- L295 `_members_of(owner: Client, channel_id: str)` (method)
- L299 `_plugin_id(owner: Client)` (method)
- L303 `test_it_does_not_join_a_private_channel(self, janus: None, client: Client)` (method)
- L321 `test_a_disabled_agent_still_joins(self, janus: None, client: Client)` (method)
- L335 `test_a_retired_agent_is_not_added(self, janus: None, client: Client)` (method)
- L351 `test_an_agent_somebody_attached_for_themselves_is_not_added(self, janus: None, client: Client)` (method)
- L371 `TestTheSlugAloneIsNotIdentity` (class) — A `janus` row is not this seeder's row unless it has this seeder's shape.
- L374 `test_a_container_row_is_not_adopted(self, janus: None, client: Client)` (method)
- L418 `test_somebodys_own_agent_is_not_adopted(self, janus: None, client: Client)` (method)
- L454 `test_a_taken_slug_does_not_stop_the_boot_reconcile(self, janus: None, client: Client)` (method)
- L478 `turn_janus_on(monkeypatch: pytest.MonkeyPatch)` (function) — What the `janus` fixture does, for a test that has to sign up with it off first.
- L484 `make_workspace(admin: Client, name: str)` (function)
- L490 `owner_of(workspace_id: str)` (function)
- L502 `StandInEnsure` (class) — A stand-in for `ensure` that remembers every workspace it was asked about.
- L516 `__init__(self, *, fail_first: bool=False, answer: str | None='a-plugin')` (method)
- L522 `__call__(self, session: AsyncSession, workspace_id: str, *, installed_by: str)` (method)
- L535 `visited(self)` (method)
- L539 `TestReconcilingAtBoot` (class)
- L540 `test_a_workspace_that_predates_the_setting_gains_it_at_boot(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method) — Founded before anybody turned Janus on, which is every workspace on the deploy
- L560 `test_reconciling_twice_seeds_nothing_the_second_time(self, janus: None, client: Client)` (method)
- L567 `test_one_workspaces_failure_costs_no_other_its_agent(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L588 `test_each_workspace_is_seeded_as_its_own_owner(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L607 `test_a_workspace_with_no_owner_is_left_alone(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L627 `test_a_workspace_that_gained_nothing_is_not_counted(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L643 `TestAWorkspaceFoundedAfterBoot` (class)
- L644 `test_signing_up_seeds_it(self, janus: None, client: Client)` (method)
- L653 `test_signing_up_seeds_nothing_when_it_is_not_running(self, client: Client)` (method)
- L662 `TestTheUrlIsNotExemptFromTheGuardItSkips` (class)
- L663 `test_https_is_required_for_registered_urls(self, client: Client)` (method)
- L686 `test_private_hosts_are_refused_even_with_https(self, client: Client)` (method)
