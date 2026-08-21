---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:24:31'
updated: '2026-08-21T07:24:31'
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
- L94 `test_matches_keywords(body: str, keywords: list[str], expected: bool)` (function)
- L99 `test_never_notifies_the_author_of_their_own_message()` (function)
- L103 `test_stays_silent_for_ordinary_channel_chatter()` (function)
- L107 `test_notifies_on_a_direct_mention_and_counts_a_badge()` (function)
- L113 `test_notifies_every_recipient_of_a_dm()` (function)
- L118 `test_notifies_on_a_keyword_hit()` (function)
- L124 `test_notifies_about_all_activity_when_the_channel_is_set_to_all()` (function)
- L129 `test_says_nothing_at_all_when_muted_even_for_a_mention()` (function)
- L133 `test_respects_a_manual_snooze()` (function)
- L138 `test_notifies_thread_subscribers_without_counting_a_badge()` (function)
- L143 `test_channel_wide_mentions_skip_people_who_muted()` (function)
- L152 `with_dnd(**overrides)` (function)
- L158 `test_quiet_outside_working_hours()` (function)
- L163 `test_allows_notifications_during_working_hours()` (function)
- L167 `test_quiet_on_a_non_working_day()` (function)
- L172 `test_handles_a_window_that_wraps_midnight()` (function)
- L178 `test_respects_the_recipient_timezone_rather_than_the_server_clock()` (function)
- L188 `test_does_nothing_when_dnd_is_off()` (function)
- L205 `test_unfurl_refuses_private_addresses(address: str, private: bool)` (function)
- L209 `test_first_url_finds_the_leading_link()` (function)
