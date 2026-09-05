---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:55'
updated: '2026-09-05T07:22:55'
---

# apps/api/tests/test_security_headers.py

Symbols in `apps/api/tests/test_security_headers.py`.

- L21 `_policy(header: str)` (function)
- L30 `TestThePolicyItself` (class)
- L31 `test_scripts_come_only_from_this_origin(self)` (method)
- L40 `test_uploads_and_attachment_redirects_reach_object_storage(self)` (method)
- L52 `test_the_socket_is_allowed_by_scheme_too(self)` (method)
- L62 `test_extra_sources_widen_connect_and_images_only(self)` (method)
- L74 `test_a_route_with_its_own_policy_keeps_it(self)` (method)
- L80 `test_the_api_docs_get_every_header_but_the_policy(self)` (method)
- L85 `test_hsts_only_over_https(self)` (method)
- L92 `TestOnTheWire` (class)
- L93 `test_an_api_response_carries_them(self, client: Client)` (method)
- L100 `test_so_does_a_refusal_from_the_session_middleware(self, client: Client)` (method)
- L108 `test_the_docs_page_is_exempt_from_the_policy(self, client: Client)` (method)
- L114 `test_a_signed_in_response_carries_them_too(self, client: Client)` (method)
- L120 `test_the_switch_turns_it_off(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
