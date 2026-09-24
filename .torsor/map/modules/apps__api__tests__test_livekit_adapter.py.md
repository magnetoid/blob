---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/tests/test_livekit_adapter.py

Symbols in `apps/api/tests/test_livekit_adapter.py`.

- L26 `configured(monkeypatch: pytest.MonkeyPatch)` (function)
- L32 `_signed(body: str, secret: str=SECRET)` (function)
- L37 `test_configured_needs_all_three(monkeypatch: pytest.MonkeyPatch, configured: None)` (function)
- L43 `test_the_api_url_defaults_to_where_browsers_go(monkeypatch: pytest.MonkeyPatch, configured: None)` (function)
- L51 `test_a_token_carries_exactly_the_sources_it_was_given(configured: None)` (function)
- L65 `test_a_token_is_short_lived(configured: None)` (function)
- L69 `test_a_webhook_signed_with_our_key_is_accepted(configured: None)` (function)
- L76 `test_a_bearer_prefix_is_tolerated(configured: None)` (function)
- L81 `test_a_changed_body_is_refused(configured: None)` (function)
- L88 `test_another_secret_is_refused(configured: None)` (function)
- L94 `test_nothing_is_accepted_without_a_configured_livekit()` (function)
- L100 `test_an_empty_url_is_unavailable_not_a_crash(monkeypatch: pytest.MonkeyPatch)` (function) — `api.LiveKitAPI` raises `ValueError` on an empty url. Every caller in this codebase
