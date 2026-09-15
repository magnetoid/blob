---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:40:20'
updated: '2026-09-15T23:40:20'
---

# apps/api/tests/test_agent_dm.py

Symbols in `apps/api/tests/test_agent_dm.py`.

- L42 `says(text_: str)` (function) — A complete AG-UI reply: one text message, then the run finishes.
- L54 `janus(monkeypatch: pytest.MonkeyPatch)` (function)
- L60 `bot_named(owner: Client, name: str)` (function)
- L65 `open_dm(owner: Client, *user_ids: str)` (function)
- L71 `say(owner: Client, channel_id: str, body: str)` (function)
- L78 `replies_in(owner: Client, channel_id: str)` (function)
- L84 `mine(janus: None, client: Client, monkeypatch: pytest.MonkeyPatch)` (function) — A founder, their DM with the seeded agent, and the fake that answers for it.
- L93 `TestTheRoomIsTheAddress` (class)
- L94 `test_the_seeded_agent_answers_without_being_mentioned(self, mine: dict)` (method)
- L101 `test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict)` (method)
- L106 `test_its_own_replies_do_not_start_another_run(self, mine: dict)` (method)
- L127 `TestWhoElseIsInTheRoom` (class)
- L128 `test_a_dm_with_a_person_is_untouched(self, mine: dict)` (method)
- L137 `test_a_third_member_stops_it_answering(self, mine: dict)` (method)
- L152 `test_a_group_dm_is_not_a_personal_room(self, mine: dict)` (method)
- L161 `TestWhichAgentsTheRoomAddresses` (class)
- L162 `test_an_app_installed_by_hand_still_needs_a_mention(self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L177 `test_a_persons_own_agent_answers_its_owner(self, client: Client)` (method)
- L192 `test_somebody_elses_agent_does_not_answer_you(self, client: Client)` (method)
- L206 `record_jobs(monkeypatch: pytest.MonkeyPatch)` (function) — Every `enqueue(...)` call, recorded at call time rather than when it runs.
- L225 `TestTheWayIn` (class) — Sending is what has to start the run, not a test calling the job by hand.
- L228 `test_a_plain_message_in_the_agents_dm_asks_for_a_run(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L236 `test_a_dm_between_two_people_asks_for_nothing(self, mine: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L247 `test_an_app_installed_by_hand_asks_for_nothing(self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
