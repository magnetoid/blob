---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/tests/test_mark_unread.py

Symbols in `apps/api/tests/test_mark_unread.py`.

- L22 `team(client: Client)` (function)
- L30 `say(team: dict, body: str)` (function)
- L36 `read_state(client: Client, channel_id: str)` (function)
- L41 `TestWhereTheCursorLands` (class)
- L42 `test_the_marked_message_becomes_the_first_unread(self, team: dict)` (method)
- L55 `test_marking_the_very_first_message_clears_the_cursor(self, team: dict)` (method)
- L64 `test_it_survives_a_reload(self, team: dict)` (method)
- L73 `test_a_message_from_another_channel_is_refused(self, team: dict)` (method)
- L87 `TestTheRatchetIsStillARatchet` (class)
- L88 `test_marking_read_backwards_is_still_a_no_op(self, team: dict)` (method)
- L102 `TestTheBadgeComesBack` (class)
- L103 `test_a_mention_left_unread_counts_again(self, team: dict)` (method)
- L116 `test_your_own_message_never_counts(self, team: dict)` (method)
- L127 `test_a_group_mention_counts_too(self, team: dict)` (method)
