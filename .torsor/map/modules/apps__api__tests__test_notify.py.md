---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:43'
updated: '2026-09-04T07:26:43'
---

# apps/api/tests/test_notify.py

Symbols in `apps/api/tests/test_notify.py`.

- L40 `message(**overrides)` (function)
- L54 `recipient(user_id: str='u1', **overrides)` (function)
- L59 `test_finds_a_simple_mention()` (function)
- L63 `test_prefers_the_longest_matching_name()` (function)
- L68 `test_ignores_trailing_punctuation()` (function)
- L72 `test_deduplicates_repeated_mentions()` (function)
- L76 `test_recognises_channel_and_here()` (function)
- L84 `test_never_mentions_anyone_from_inside_code()` (function)
- L90 `test_ignores_unknown_names_and_email_addresses()` (function)
- L96 `test_the_lookup_offers_every_prefix_of_a_mention()` (function)
- L106 `test_the_lookup_matches_how_postgres_lowercases()` (function)
- L116 `test_ordinary_names_gain_nothing_from_that()` (function)
- L122 `test_a_body_with_no_mention_asks_nothing()` (function)
- L138 `test_matches_keywords(body: str, keywords: list[str], expected: bool)` (function)
- L143 `test_never_notifies_the_author_of_their_own_message()` (function)
- L147 `test_stays_silent_for_ordinary_channel_chatter()` (function)
- L151 `test_notifies_on_a_direct_mention_and_counts_a_badge()` (function)
- L157 `test_notifies_every_recipient_of_a_dm()` (function)
- L162 `test_notifies_on_a_keyword_hit()` (function)
- L168 `test_notifies_about_all_activity_when_the_channel_is_set_to_all()` (function)
- L173 `test_says_nothing_at_all_when_muted_even_for_a_mention()` (function)
- L177 `test_respects_a_manual_snooze()` (function)
- L182 `test_notifies_thread_subscribers_without_counting_a_badge()` (function)
- L187 `test_channel_wide_mentions_skip_people_who_muted()` (function)
- L200 `test_here_reaches_the_people_who_are_active()` (function)
- L209 `test_here_does_not_reach_someone_who_is_away()` (function)
- L220 `test_channel_still_reaches_everybody()` (function)
- L230 `test_here_notifies_everyone_when_presence_cannot_be_read()` (function)
- L242 `test_someone_here_skips_is_still_reachable_another_way()` (function)
- L252 `test_a_direct_mention_beats_being_away()` (function)
- L262 `with_dnd(**overrides)` (function)
- L268 `test_quiet_outside_working_hours()` (function)
- L273 `test_allows_notifications_during_working_hours()` (function)
- L277 `test_quiet_on_a_non_working_day()` (function)
- L282 `test_handles_a_window_that_wraps_midnight()` (function)
- L288 `test_respects_the_recipient_timezone_rather_than_the_server_clock()` (function)
- L298 `test_does_nothing_when_dnd_is_off()` (function)
- L315 `test_unfurl_refuses_private_addresses(address: str, private: bool)` (function)
- L319 `test_first_url_finds_the_leading_link()` (function)
- L324 `TestUnfurlFollowsRedirectsSafely` (class) — A link is attacker-controlled input that makes the server fetch something.
- L334 `test_a_redirect_into_a_private_address_is_refused(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L374 `test_a_redirect_to_a_public_page_is_still_followed(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L410 `test_an_inert_guard_now_refuses_rather_than_returning_a_reason(monkeypatch: pytest.MonkeyPatch)` (function) — Two call sites awaited the checker and dropped its answer on the floor.
