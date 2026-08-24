---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T17:27:50'
updated: '2026-08-24T17:27:50'
---

# apps/api/tests/test_notify.py

Symbols in `apps/api/tests/test_notify.py`.

- L28 `message(**overrides)` (function)
- L42 `recipient(user_id: str='u1', **overrides)` (function)
- L47 `test_finds_a_simple_mention()` (function)
- L51 `test_prefers_the_longest_matching_name()` (function)
- L56 `test_ignores_trailing_punctuation()` (function)
- L60 `test_deduplicates_repeated_mentions()` (function)
- L64 `test_recognises_channel_and_here()` (function)
- L72 `test_never_mentions_anyone_from_inside_code()` (function)
- L78 `test_ignores_unknown_names_and_email_addresses()` (function)
- L84 `test_the_lookup_offers_every_prefix_of_a_mention()` (function)
- L94 `test_the_lookup_matches_how_postgres_lowercases()` (function)
- L104 `test_ordinary_names_gain_nothing_from_that()` (function)
- L110 `test_a_body_with_no_mention_asks_nothing()` (function)
- L126 `test_matches_keywords(body: str, keywords: list[str], expected: bool)` (function)
- L131 `test_never_notifies_the_author_of_their_own_message()` (function)
- L135 `test_stays_silent_for_ordinary_channel_chatter()` (function)
- L139 `test_notifies_on_a_direct_mention_and_counts_a_badge()` (function)
- L145 `test_notifies_every_recipient_of_a_dm()` (function)
- L150 `test_notifies_on_a_keyword_hit()` (function)
- L156 `test_notifies_about_all_activity_when_the_channel_is_set_to_all()` (function)
- L161 `test_says_nothing_at_all_when_muted_even_for_a_mention()` (function)
- L165 `test_respects_a_manual_snooze()` (function)
- L170 `test_notifies_thread_subscribers_without_counting_a_badge()` (function)
- L175 `test_channel_wide_mentions_skip_people_who_muted()` (function)
- L184 `with_dnd(**overrides)` (function)
- L190 `test_quiet_outside_working_hours()` (function)
- L195 `test_allows_notifications_during_working_hours()` (function)
- L199 `test_quiet_on_a_non_working_day()` (function)
- L204 `test_handles_a_window_that_wraps_midnight()` (function)
- L210 `test_respects_the_recipient_timezone_rather_than_the_server_clock()` (function)
- L220 `test_does_nothing_when_dnd_is_off()` (function)
- L237 `test_unfurl_refuses_private_addresses(address: str, private: bool)` (function)
- L241 `test_first_url_finds_the_leading_link()` (function)
- L246 `TestUnfurlFollowsRedirectsSafely` (class) — A link is attacker-controlled input that makes the server fetch something.
- L256 `test_a_redirect_into_a_private_address_is_refused(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L296 `test_a_redirect_to_a_public_page_is_still_followed(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L332 `test_an_inert_guard_now_refuses_rather_than_returning_a_reason(monkeypatch: pytest.MonkeyPatch)` (function) — Two call sites awaited the checker and dropped its answer on the floor.
