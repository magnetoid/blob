---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T04:17:08'
updated: '2026-09-06T04:17:08'
---

# apps/api/tests/test_channel_events.py

Symbols in `apps/api/tests/test_channel_events.py`.

- L25 `watcher(name: str, user_id: str, workspace_id: str, channel_ids: list[str])` (function)
- L32 `frames(conn: Any)` (function)
- L41 `of_kind(conn: Any, kind: str)` (function)
- L46 `team(client: Client)` (function)
- L55 `TestWhatTheRoomIsTold` (class)
- L56 `test_a_topic_edit_carries_the_channel_and_nobody_s_standing_in_it(self, team: dict[str, Any])` (method)
- L71 `test_reopening_a_channel_the_admin_is_not_in_says_nothing_about_membership(self, team: dict[str, Any])` (method)
- L93 `test_a_new_public_channel_reaches_the_workspace_without_a_membership(self, team: dict[str, Any])` (method)
- L118 `test_being_added_brings_the_channel_and_your_standing_in_it(self, team: dict[str, Any])` (method)
- L142 `TestWhatOnlyYouAreTold` (class)
- L143 `test_muting_a_channel_is_told_to_you_and_to_nobody_else(self, team: dict[str, Any])` (method)
- L160 `test_the_slash_command_that_mutes_tells_the_same_person_the_same_thing(self, team: dict[str, Any])` (method)
- L176 `test_a_topic_command_tells_the_room_about_the_channel_only(self, team: dict[str, Any])` (method)
- L191 `test_an_edit_does_not_disturb_what_the_room_had_read(self, team: dict[str, Any])` (method) — The bug this all exists for: the editor's read cursor is not everyone's.
