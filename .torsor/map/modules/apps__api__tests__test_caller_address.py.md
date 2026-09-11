---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/tests/test_caller_address.py

Symbols in `apps/api/tests/test_caller_address.py`.

- L26 `_Connection` (class) — The two things `client_ip` reads, and nothing else.
- L29 `__init__(self, forwarded: str | None, peer: str | None='10.0.0.9')` (method)
- L34 `TestCountingFromTheRight` (class)
- L35 `test_one_proxy_takes_the_entry_it_appended(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L40 `test_two_layers_step_past_the_inner_one(self, monkeypatch: pytest.MonkeyPatch)` (method) — The reference deployment: nginx in front of Coolify's Traefik.
- L47 `test_the_made_up_entry_is_never_reached(self, monkeypatch: pytest.MonkeyPatch)` (method) — The bug: the leftmost entry is the one the caller invented.
- L54 `test_a_chain_shorter_than_configured_falls_back_to_the_peer(self, monkeypatch: pytest.MonkeyPatch)` (method) — A request that did not come through the proxy has nothing to trust in it.
- L66 `test_no_header_and_no_peer_is_none_not_a_crash(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L73 `test_something_that_is_not_an_address_is_nothing(self, monkeypatch: pytest.MonkeyPatch)` (method) — `audit_events.ip` is an `inet`. Without this the caller chooses whether it 500s.
- L84 `test_a_negative_setting_cannot_reach_off_the_end(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L92 `founded(client: Client)` (function)
- L97 `TestTheLimitCannotBeShakenOff` (class)
- L98 `test_the_bucket_is_the_caller_not_the_header_they_wrote(self, founded: Client, monkeypatch: pytest.MonkeyPatch)` (method) — One caller, five invented leftmost entries, one bucket.
- L124 `test_a_different_caller_still_gets_their_own_bucket(self, founded: Client, monkeypatch: pytest.MonkeyPatch)` (method) — The limit must key on the caller, not collapse everybody into one.
- L149 `TestTheAuditLogRecordsSomethingTrue` (class)
- L150 `test_the_address_stamped_is_the_one_the_proxy_vouched_for(self, founded: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L168 `test_no_route_reads_the_client_address_directly()` (function) — The guard that keeps this fixed.
