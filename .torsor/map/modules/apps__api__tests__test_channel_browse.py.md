---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:20'
updated: '2026-09-02T05:49:20'
---

# apps/api/tests/test_channel_browse.py

Symbols in `apps/api/tests/test_channel_browse.py`.

- L17 `team(client: Client)` (function)
- L23 `browse(client: Client, query: str='', archived: bool=False)` (function)
- L30 `TestWhatTheDirectoryShows` (class)
- L31 `test_it_lists_public_channels_with_a_member_count(self, team: dict)` (method)
- L39 `test_a_channel_you_are_not_in_is_offered_to_join(self, team: dict)` (method)
- L49 `test_search_matches_name_description_and_topic(self, team: dict)` (method)
- L61 `test_archived_channels_are_out_unless_asked_for(self, team: dict)` (method)
- L71 `TestWhatItMustNotShow` (class)
- L72 `test_a_private_channel_you_are_not_in_is_invisible(self, team: dict)` (method)
- L80 `test_a_private_channel_you_are_in_is_not_listed_either(self, team: dict)` (method)
- L88 `test_another_workspace_cannot_be_browsed_into(self, team: dict)` (method)
