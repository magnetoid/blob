---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/tests/test_agent_decisions.py

Symbols in `apps/api/tests/test_agent_decisions.py`.

- L39 `_nothing()` (function) — What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing.
- L43 `asks(*, schema: dict | None=None, message: str='Deploy to prod?', item_id: str | None='i1', expires_at: str | None=None, with_state: bool=True)` (function) — A run that shares some state and then stops to ask.
- L75 `streamed(*chunks: bytes)` (function)
- L91 `agent(client: Client, monkeypatch: pytest.MonkeyPatch)` (function)
- L147 `ask(agent: dict, *chunks: bytes)` (function)
- L157 `the_run(agent: dict)` (function)
- L176 `blocks_of(message_id: str)` (function)
- L186 `answer_message(run_id: str)` (function)
- L202 `button(run_id: str, index: int)` (function)
- L206 `press(agent: dict, who: Client, run: dict, index: int=0, client_action_id: str='click-1')` (function)
- L220 `resume(agent: dict, run: dict, *chunks: bytes)` (function) — Drive the resume the answer enqueued, as the worker would, and return its requests.
- L231 `TestWhatTheButtonsAre` (class)
- L232 `test_a_schema_enum_becomes_buttons(self)` (method)
- L241 `test_a_boolean_becomes_yes_and_no(self)` (method)
- L248 `test_no_schema_becomes_a_text_input(self)` (method)
- L254 `test_a_one_of_with_titles_uses_the_titles(self)` (method)
- L260 `test_choices_are_never_invented_from_prose(self)` (method)
- L264 `test_a_choice_that_is_not_on_offer_is_refused(self)` (method)
- L270 `test_the_action_id_names_its_run(self)` (method)
- L277 `TestAskingAndAnswering` (class)
- L278 `test_an_interrupt_stores_its_question_and_its_state(self, agent: dict)` (method)
- L291 `test_the_asker_answers_and_the_agent_resumes_with_state(self, agent: dict)` (method)
- L323 `test_a_resume_is_not_a_hop(self, agent: dict)` (method)
- L341 `test_resumed_posts_have_distinct_client_ids(self, agent: dict)` (method)
- L354 `test_the_rest_route_is_the_same_entrance(self, agent: dict)` (method)
- L368 `test_the_answer_does_not_root_a_second_run(self, agent: dict)` (method)
- L381 `test_a_resume_runs_only_the_agent_that_asked(self, agent: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L402 `TestWhoMayAnswer` (class)
- L403 `test_somebody_else_cannot(self, agent: dict)` (method)
- L413 `test_a_second_answer_is_refused(self, agent: dict)` (method)
- L430 `test_the_same_click_twice_is_one_decision(self, agent: dict)` (method)
- L440 `test_a_pressed_decision_is_not_webhooked_to_the_agent(self, agent: dict)` (method)
- L461 `TestWaiting` (class)
- L462 `test_a_waiting_run_stays_listed_past_an_hour(self, agent: dict)` (method)
- L476 `test_an_expired_decision_is_refused(self, agent: dict)` (method)
- L490 `test_the_sweep_expires_waiting_runs_and_settles_their_cards(self, agent: dict)` (method)
- L508 `test_the_agents_own_deadline_wins_when_it_is_sooner(self, agent: dict)` (method)
- L514 `TestTheOtherTransports` (class)
- L515 `test_a_socket_agent_receives_the_resume_input(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
