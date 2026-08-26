---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/tests/test_password_reset.py

Symbols in `apps/api/tests/test_password_reset.py`.

- L29 `sent_links(monkeypatch: pytest.MonkeyPatch)` (function) — Capture reset links instead of mailing them.
- L44 `request_reset(client: Client, email: str, links: list[str])` (function)
- L51 `TestTheEmail` (class)
- L52 `test_the_link_is_the_path_the_client_parses(self, client: Client, sent_links: list[str])` (method)
- L67 `test_an_address_nobody_holds_is_answered_the_same_way(self, client: Client, sent_links: list[str])` (method)
- L77 `test_a_deactivated_account_gets_no_link(self, client: Client, sent_links: list[str])` (method)
- L91 `TestFollowingTheLink` (class)
- L92 `test_it_sets_the_password_and_signs_you_in(self, client: Client, sent_links: list[str])` (method)
- L109 `test_the_old_password_stops_working_and_the_new_one_starts(self, client: Client, sent_links: list[str])` (method)
- L128 `test_every_other_session_is_signed_out(self, client: Client, sent_links: list[str])` (method)
- L151 `test_the_token_works_once(self, client: Client, sent_links: list[str])` (method)
- L167 `test_a_token_nobody_minted_is_refused(self, client: Client)` (method)
- L175 `test_a_short_password_is_refused_the_way_signup_refuses_one(self, client: Client, sent_links: list[str])` (method)
