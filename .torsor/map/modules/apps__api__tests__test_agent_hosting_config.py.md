---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:51'
updated: '2026-09-04T17:42:51'
---

# apps/api/tests/test_agent_hosting_config.py

Symbols in `apps/api/tests/test_agent_hosting_config.py`.

- L20 `_settings(**overrides: str)` (function)
- L25 `test_hosting_is_off_until_it_is_configured()` (function)
- L29 `test_the_runner_needs_every_piece_before_it_will_start()` (function)
- L40 `test_fully_configured_hosting_is_on()` (function)
- L51 `test_coolifys_own_injected_url_is_not_what_we_read()` (function) — The regression guard for the name collision.
- L69 `test_a_blank_setting_counts_as_unset()` (function)
- L75 `TestTheHostnameTheRunnerReports` (class) — Coolify reports a hostname in two different shapes, and one of them used to
- L81 `test_a_scheme_that_is_already_there_is_not_doubled(self)` (method)
- L89 `test_a_bare_hostname_gets_one(self)` (method)
- L94 `test_the_first_of_several_domains_wins(self)` (method)
- L101 `test_nothing_assigned_yet_stays_nothing(self)` (method)
- L108 `test_what_comes_out_can_always_have_a_path_appended(self)` (method)
- L119 `TestWhichDomainFieldWins` (class) — `fqdn` is stamped at creation and survives every later domain change, while
- L125 `test_the_compose_domain_beats_the_stale_fqdn(self)` (method)
- L134 `test_a_compose_domain_port_names_the_container_not_the_public_side(self)` (method)
- L146 `test_no_compose_domains_falls_back_to_fqdn(self)` (method)
- L155 `test_garbage_compose_domains_fall_back_rather_than_fail(self)` (method)
