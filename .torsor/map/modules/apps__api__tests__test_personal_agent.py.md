---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_personal_agent.py

Symbols in `apps/api/tests/test_personal_agent.py`.

- L37 `agent_user_id(owner: Client)` (function)
- L42 `open_dm(owner: Client, *user_ids: str)` (function)
- L48 `say(owner: Client, channel_id: str, body: str)` (function)
- L55 `replies_in(owner: Client, channel_id: str)` (function)
- L61 `mine(model: dict, client: Client)` (function) — A founder, and their DM with the workspace agent.
- L68 `TestTheRoomIsTheAddress` (class)
- L69 `test_it_answers_without_being_mentioned(self, mine: dict)` (method)
- L78 `test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict)` (method)
- L87 `test_its_own_replies_do_not_start_another_run(self, mine: dict)` (method)
- L109 `TestWhoElseIsInTheRoom` (class)
- L110 `test_a_dm_with_a_person_is_untouched(self, mine: dict, client: Client)` (method)
- L118 `test_a_third_member_stops_it_answering(self, mine: dict)` (method)
- L135 `test_a_group_dm_is_not_a_personal_room(self, mine: dict)` (method)
- L143 `test_a_third_party_app_is_not_dragged_in(self, mine: dict)` (method)
- L156 `TestWhatItIsTold` (class)
- L157 `test_a_dm_is_not_described_as_a_group_chat(self)` (method)
- L168 `test_it_is_told_to_admit_it_cannot_see_the_workspace(self)` (method)
- L178 `test_a_channel_is_still_described_as_a_channel(self)` (method)
- L186 `TestItLooksBusy` (class)
- L187 `test_it_shows_as_typing_while_it_thinks(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method) — The room must not be empty while the model writes.
- L218 `TestTheRunLog` (class)
- L219 `test_a_dm_run_is_recorded_like_any_other(self, mine: dict)` (method)
- L230 `TestSeeding` (class)
- L231 `test_reconciling_skips_a_workspace_that_already_has_it(self, mine: dict)` (method)
- L249 `record_jobs(monkeypatch: pytest.MonkeyPatch)` (function) — Every `enqueue(...)` call, recorded at call time rather than when it runs.
- L271 `TestTheWayIn` (class) — Sending is what has to start the run, not a test calling the job by hand.
- L286 `test_a_plain_message_in_the_agents_dm_asks_for_a_run(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L294 `test_mentioning_it_by_name_still_does(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L302 `test_a_dm_between_two_people_asks_for_nothing(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method) — The predicate has to be the agent, not the fact that it is a DM.
- L318 `test_the_agents_own_reply_asks_for_nothing(self, mine: dict)` (method) — ADR 0013: only a person's message roots a chain.
