---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/tests/test_personal_agent.py

Symbols in `apps/api/tests/test_personal_agent.py`.

- L35 `agent_user_id(owner: Client)` (function)
- L40 `open_dm(owner: Client, *user_ids: str)` (function)
- L46 `say(owner: Client, channel_id: str, body: str)` (function)
- L53 `replies_in(owner: Client, channel_id: str)` (function)
- L59 `mine(model: dict, client: Client)` (function) — A founder, and their DM with the workspace agent.
- L66 `TestTheRoomIsTheAddress` (class)
- L67 `test_it_answers_without_being_mentioned(self, mine: dict)` (method)
- L76 `test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict)` (method)
- L85 `test_its_own_replies_do_not_start_another_run(self, mine: dict)` (method)
- L107 `TestWhoElseIsInTheRoom` (class)
- L108 `test_a_dm_with_a_person_is_untouched(self, mine: dict, client: Client)` (method)
- L116 `test_a_third_member_stops_it_answering(self, mine: dict)` (method)
- L133 `test_a_group_dm_is_not_a_personal_room(self, mine: dict)` (method)
- L141 `test_a_third_party_app_is_not_dragged_in(self, mine: dict)` (method)
- L154 `TestWhatItIsTold` (class)
- L155 `test_a_dm_is_not_described_as_a_group_chat(self)` (method)
- L166 `test_it_is_told_to_admit_it_cannot_see_the_workspace(self)` (method)
- L176 `test_a_channel_is_still_described_as_a_channel(self)` (method)
- L184 `TestItLooksBusy` (class)
- L185 `test_it_shows_as_typing_while_it_thinks(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method) — The room must not be empty while the model writes.
- L216 `TestTheRunLog` (class)
- L217 `test_a_dm_run_is_recorded_like_any_other(self, mine: dict)` (method)
- L228 `TestSeeding` (class)
- L229 `test_reconciling_skips_a_workspace_that_already_has_it(self, mine: dict)` (method)
