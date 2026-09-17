---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T02:03:40'
updated: '2026-09-17T02:03:40'
---

# apps/api/tests/test_janus_agent.py

Symbols in `apps/api/tests/test_janus_agent.py`.

- L29 `build(**overrides: str)` (function) — A `Settings` built from these values alone, the way test_llm_config does.
- L34 `TestSettings` (class)
- L35 `test_janus_is_off_by_default(self)` (method)
- L39 `test_the_default_name_is_janus(self)` (method)
- L42 `test_a_blank_value_reads_as_unset(self)` (method)
- L50 `test_a_blank_name_falls_back_to_the_default(self)` (method)
- L57 `test_manifest_does_not_raise_when_the_name_is_blank(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L72 `janus(monkeypatch: pytest.MonkeyPatch)` (function) — The live singleton, turned on for the tests that need it. `conftest.py` forces
- L80 `TestSeeding` (class)
- L81 `test_nothing_is_seeded_when_it_is_not_running(self, client: Client)` (method)
- L86 `test_it_is_installed_with_the_manifest_scopes(self, janus: None, client: Client)` (method)
- L120 `test_the_secret_is_the_configured_one(self, janus: None, client: Client)` (method)
- L140 `test_seeding_twice_installs_once(self, janus: None, client: Client)` (method)
- L150 `test_an_existing_janus_moves_to_the_internal_url(self, janus: None, client: Client)` (method) — Production already has a `janus` row pointing at a public domain.
- L201 `test_the_secret_is_reconciled_to_the_configured_one(self, janus: None, client: Client)` (method) — A workspace that already holds a Blob-minted secret has to move to the shared one.
- L255 `TestItIsInTheRoomsItIsMentionedIn` (class)
- L256 `test_the_bot_joins_the_public_channels(self, janus: None, client: Client)` (method)
- L275 `test_a_public_channel_founded_later_has_it(self, janus: None, client: Client)` (method)
- L289 `_bot_id(owner: Client)` (method)
- L294 `_found_public(owner: Client, name: str)` (method)
- L300 `_members_of(owner: Client, channel_id: str)` (method)
- L304 `_plugin_id(owner: Client)` (method)
- L308 `test_it_does_not_join_a_private_channel(self, janus: None, client: Client)` (method)
- L326 `test_a_disabled_agent_still_joins(self, janus: None, client: Client)` (method)
- L340 `test_a_retired_agent_is_not_added(self, janus: None, client: Client)` (method)
- L356 `test_an_agent_somebody_attached_for_themselves_is_not_added(self, janus: None, client: Client)` (method)
- L377 `test_it_answers_in_a_channel_founded_after_it_was_seeded(self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L400 `TestWhatTheWorkspaceTellsIt` (class) — The agent is the same container for every workspace on the instance; the standing
- L405 `test_the_instructions_reach_janus_with_the_run(self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L433 `TestTheEverywhereSwitchHoldsAcrossABoot` (class) — Turning "join every public channel" off has to mean it, and mean it tomorrow.
- L443 `_plugin_id(owner: Client)` (method)
- L448 `_bot(owner: Client)` (method)
- L453 `_reconcile(owner: Client)` (method)
- L460 `test_it_is_still_the_resident_agent_with_the_switch_off(self, janus: None, client: Client)` (method)
- L476 `test_a_boot_does_not_re_seat_it_when_the_switch_is_off(self, janus: None, client: Client)` (method)
- L498 `test_a_boot_catches_it_up_when_the_switch_is_on(self, janus: None, client: Client)` (method)
- L522 `TestTheSlugAloneIsNotIdentity` (class) — A `janus` row is not this seeder's row unless it has this seeder's shape.
- L525 `test_a_container_row_is_not_adopted(self, janus: None, client: Client)` (method)
- L569 `test_somebodys_own_agent_is_not_adopted(self, janus: None, client: Client)` (method)
- L605 `test_a_taken_slug_does_not_stop_the_boot_reconcile(self, janus: None, client: Client)` (method)
- L629 `turn_janus_on(monkeypatch: pytest.MonkeyPatch)` (function) — The two settings the `janus` fixture turns on, for a test that has to sign up with
- L637 `make_workspace(admin: Client, name: str)` (function)
- L643 `owner_of(workspace_id: str)` (function)
- L655 `StandInEnsure` (class) — A stand-in for `ensure` that remembers every workspace it was asked about.
- L669 `__init__(self, *, fail_first: bool=False, answer: str | None='a-plugin')` (method)
- L675 `__call__(self, session: AsyncSession, workspace_id: str, *, installed_by: str)` (method)
- L688 `visited(self)` (method)
- L692 `TestReconcilingAtBoot` (class)
- L693 `test_a_workspace_that_predates_the_setting_gains_it_at_boot(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method) — Founded before anybody turned Janus on, which is every workspace on the deploy
- L713 `test_reconciling_twice_seeds_nothing_the_second_time(self, janus: None, client: Client)` (method)
- L720 `test_one_workspaces_failure_costs_no_other_its_agent(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L741 `test_each_workspace_is_seeded_as_its_own_owner(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L760 `test_a_workspace_with_no_owner_is_left_alone(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L780 `test_a_workspace_that_gained_nothing_is_not_counted(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L799 `TestAWorkspaceFoundedAfterBoot` (class)
- L800 `test_signing_up_seeds_it(self, janus: None, client: Client)` (method)
- L809 `test_signing_up_seeds_nothing_when_it_is_not_running(self, client: Client)` (method)
- L818 `TestTheUrlIsNotExemptFromTheGuardItSkips` (class)
- L819 `test_https_is_required_for_registered_urls(self, client: Client)` (method)
- L842 `test_private_hosts_are_refused_even_with_https(self, client: Client)` (method)
