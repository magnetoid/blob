---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:18'
updated: '2026-08-27T03:38:18'
---

# apps/api/tests/test_search.py

Symbols in `apps/api/tests/test_search.py`.

- L16 `team(client: Client)` (function)
- L57 `test_parse_query(raw: str, expected: dict)` (function)
- L64 `test_finds_a_message_by_word(team: dict)` (function)
- L70 `test_returns_nothing_for_a_term_nobody_said(team: dict)` (function)
- L76 `test_the_from_modifier_narrows_by_author(team: dict)` (function)
- L86 `test_the_in_modifier_narrows_by_channel(team: dict)` (function)
- L93 `test_a_deleted_message_leaves_the_index(team: dict)` (function)
- L101 `test_total_counts_all_matches_even_when_the_page_is_limited(team: dict)` (function)
- L112 `test_private_messages_stay_out_of_a_non_members_results(team: dict)` (function)
- L121 `test_sync_returns_only_what_was_missed(team: dict)` (function)
- L136 `test_sync_without_cursors_replays_nothing(team: dict)` (function)
- L144 `TestDateModifiers` (class)
- L145 `test_a_bad_date_is_refused_as_input(self, team: dict)` (method)
- L153 `test_a_real_date_still_narrows(self, team: dict)` (method)
