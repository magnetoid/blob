---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/tests/test_workspace_isolation.py

Symbols in `apps/api/tests/test_workspace_isolation.py`.

- L38 `two_workspaces(client: Client)` (function) — One person, two workspaces, and a user id belonging to each.
- L73 `frames_until(ws: object, kind: str, timeout: float=3.0)` (function) — Every frame up to and including one of `kind`.
- L93 `members_of(channel_id: str)` (function)
- L104 `TestChannelMembership` (class)
- L105 `test_a_person_from_another_workspace_cannot_be_added(self, two_workspaces: dict)` (method)
- L118 `test_the_refusal_is_all_or_nothing(self, two_workspaces: dict)` (method)
- L133 `test_a_foreign_id_cannot_ride_in_on_channel_creation(self, two_workspaces: dict)` (method)
- L148 `test_somebody_in_this_workspace_still_goes_in(self, two_workspaces: dict)` (method)
- L159 `TestPresence` (class)
- L160 `test_a_foreign_id_is_never_watched(self, two_workspaces: dict)` (method)
- L180 `test_no_state_comes_back_for_one(self, two_workspaces: dict)` (method)
- L200 `TestHealth` (class)
- L201 `test_the_totals_count_only_this_workspace(self, two_workspaces: dict)` (method)
