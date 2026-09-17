---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T02:23:41'
updated: '2026-09-17T02:23:41'
---

# apps/api/tests/test_admin_janus.py

Symbols in `apps/api/tests/test_admin_janus.py`.

- L47 `config_body()` (function) — `GET /v1/config` as Janus 0.17.0 serves it — plus one thing it never would.
- L135 `FakeJanus` (class) — Every request Blob made, and what Janus answered.
- L142 `__init__(self)` (method)
- L160 `transport(self)` (method)
- L163 `_handle(self, request: httpx.Request)` (method)
- L180 `janus(monkeypatch: pytest.MonkeyPatch)` (function) — Janus running beside us, faked at the transport.
- L198 `janus_off(monkeypatch: pytest.MonkeyPatch)` (function) — Nothing beside us. Forced rather than assumed: a developer's own `.env` may name a
- L204 `audit_rows(action: str)` (function)
- L217 `TestApiBase` (class)
- L218 `test_the_api_base_is_the_agui_origin(self, janus: FakeJanus)` (method)
- L223 `test_configured_needs_all_three(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L232 `TestRedaction` (class) — The rule for a credential written into `config.yaml` by hand.
- L239 `test_only_the_value_goes(self)` (method)
- L256 `test_a_commented_out_key_is_still_a_key(self)` (method)
- L263 `test_a_value_too_short_to_be_a_credential_is_not_a_scrub_needle(self)` (method)
- L270 `test_a_file_with_no_credentials_comes_back_byte_for_byte(self)` (method)
- L275 `test_an_environment_reference_is_not_a_credential(self)` (method)
- L290 `test_a_bare_dollar_name_is_not_a_reference(self)` (method)
- L297 `test_a_reference_with_a_literal_beside_it_is_still_a_credential(self)` (method)
- L304 `test_an_empty_or_absent_value_is_left_alone(self)` (method)
- L309 `test_yaml_s_ways_of_writing_nothing_are_left_alone(self)` (method)
- L314 `test_an_empty_key_does_not_swallow_the_line_below_it(self)` (method)
- L322 `test_a_key_in_a_sequence_item_is_redacted(self)` (method)
- L329 `test_a_hash_inside_a_value_belongs_to_the_value(self)` (method)
- L338 `test_a_real_comment_after_a_value_survives(self)` (method)
- L344 `TestOverview` (class)
- L345 `test_it_composes_the_five_routes_and_blobs_own_facts(self, janus: FakeJanus, client: Client)` (method)
- L371 `test_one_failing_route_degrades_only_its_own_tile(self, janus: FakeJanus, client: Client)` (method)
- L385 `test_a_rejected_bearer_names_the_setting_that_is_wrong(self, janus: FakeJanus, client: Client)` (method)
- L400 `test_a_key_value_never_reaches_the_overview(self, janus: FakeJanus, client: Client)` (method)
- L413 `test_a_managed_install_says_so_on_the_read_tile_too(self, janus: FakeJanus, client: Client)` (method)
- L426 `test_a_managed_install_with_nothing_to_say_still_says_something(self, janus: FakeJanus, client: Client)` (method)
- L436 `test_a_key_written_into_the_file_is_redacted_out_of_raw(self, janus: FakeJanus, client: Client)` (method)
- L463 `test_no_database_connection_is_held_while_janus_is_asked(self, janus: FakeJanus, client: Client)` (method)
- L475 `test_installs_lists_the_seeded_row_and_not_a_persons_own(self, janus: FakeJanus, client: Client)` (method)
- L518 `test_a_workspace_admin_who_does_not_run_the_server_is_refused(self, janus: FakeJanus, client: Client)` (method)
- L528 `test_every_route_says_so_when_janus_is_not_in_this_stack(self, janus_off: None, client: Client)` (method)
- L541 `test_the_agent_without_the_api_key_is_still_not_configured(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L557 `TestUpdate` (class)
- L558 `test_it_forwards_exactly_the_fields_it_was_given(self, janus: FakeJanus, client: Client)` (method)
- L592 `test_toolsets_and_raw_go_through_untouched(self, janus: FakeJanus, client: Client)` (method)
- L608 `test_a_raw_carrying_a_real_key_is_forwarded_as_written(self, janus: FakeJanus, client: Client)` (method)
- L620 `test_a_file_that_keeps_its_keys_in_the_environment_still_saves(self, janus: FakeJanus, client: Client)` (method)
- L638 `test_a_key_too_short_to_be_one_is_not_a_scrub_needle(self, janus: FakeJanus, client: Client)` (method)
- L662 `test_a_key_echoed_as_a_dict_key_is_scrubbed_too(self, janus: FakeJanus, client: Client)` (method)
- L681 `test_a_raw_that_still_holds_the_placeholder_never_reaches_janus(self, janus: FakeJanus, client: Client)` (method)
- L701 `test_a_key_inline_in_the_submitted_raw_does_not_come_back_in_the_error(self, janus: FakeJanus, client: Client)` (method)
- L727 `test_a_key_inline_in_raw_is_scrubbed_from_the_issues_too(self, janus: FakeJanus, client: Client)` (method)
- L749 `test_the_audit_row_names_the_key_and_carries_no_value(self, janus: FakeJanus, client: Client)` (method)
- L769 `test_nothing_is_audited_when_janus_refuses(self, janus: FakeJanus, client: Client)` (method)
- L781 `test_a_refusal_comes_back_as_the_first_issue(self, janus: FakeJanus, client: Client)` (method)
- L805 `test_a_refusal_with_no_issues_carries_janus_s_own_words(self, janus: FakeJanus, client: Client)` (method)
- L821 `test_a_managed_install_is_refused_in_janus_s_words(self, janus: FakeJanus, client: Client)` (method)
- L835 `test_a_refusal_that_echoes_the_key_does_not_relay_it(self, janus: FakeJanus, client: Client)` (method)
- L852 `test_janus_not_answering_is_its_own_code(self, janus: FakeJanus, client: Client)` (method)
- L863 `test_a_rejected_bearer_reads_as_unreachable(self, janus: FakeJanus, client: Client)` (method)
- L876 `test_an_empty_change_is_refused_before_it_is_sent(self, janus: FakeJanus, client: Client)` (method)
- L890 `test_a_success_body_that_echoes_a_key_does_not_relay_it(self, janus: FakeJanus, client: Client)` (method)
- L920 `test_a_malformed_address_is_unreachable_rather_than_a_crash(self, janus: FakeJanus, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L933 `test_a_junk_drain_timeout_is_read_as_no_timeout(self, janus: FakeJanus, client: Client)` (method)
- L951 `TestRestart` (class)
- L952 `test_restart_asks_for_one_and_writes_nothing(self, janus: FakeJanus, client: Client)` (method)
- L974 `test_restart_reports_a_janus_that_is_not_there(self, janus: FakeJanus, client: Client)` (method)
