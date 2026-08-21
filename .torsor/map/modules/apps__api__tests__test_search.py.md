---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T21:05:55'
updated: '2026-08-21T21:05:55'
---

# apps/api/tests/test_search.py

Symbols in `apps/api/tests/test_search.py`.

- L14 `team(client: Client)` (function)
- L52 `test_parse_query(raw: str, expected: dict)` (function)
- L59 `test_finds_a_message_by_word(team: dict)` (function)
- L65 `test_returns_nothing_for_a_term_nobody_said(team: dict)` (function)
- L71 `test_the_from_modifier_narrows_by_author(team: dict)` (function)
- L81 `test_the_in_modifier_narrows_by_channel(team: dict)` (function)
- L88 `test_a_deleted_message_leaves_the_index(team: dict)` (function)
- L98 `test_private_messages_stay_out_of_a_non_members_results(team: dict)` (function)
- L107 `test_sync_returns_only_what_was_missed(team: dict)` (function)
- L122 `test_sync_without_cursors_replays_nothing(team: dict)` (function)
