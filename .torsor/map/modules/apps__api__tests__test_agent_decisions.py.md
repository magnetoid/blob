---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/tests/test_agent_decisions.py

Symbols in `apps/api/tests/test_agent_decisions.py`.

- L41 `_nothing()` (function) — What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing.
- L45 `asks(*, schema: dict | None=None, message: str='Deploy to prod?', item_id: str | None='i1', expires_at: str | None=None, with_state: bool=True)` (function) — A run that shares some state and then stops to ask.
- L77 `streamed(*chunks: bytes)` (function)
- L93 `agent(client: Client, monkeypatch: pytest.MonkeyPatch)` (function)
- L150 `ask(agent: dict, *chunks: bytes)` (function)
- L160 `the_run(agent: dict)` (function)
- L179 `blocks_of(message_id: str)` (function)
- L189 `answer_message(run_id: str)` (function)
- L205 `button(run_id: str, index: int)` (function)
- L209 `press(agent: dict, who: Client, run: dict, index: int=0, client_action_id: str='click-1')` (function)
- L223 `resume(agent: dict, run: dict, *chunks: bytes)` (function) — Drive the resume the answer enqueued, as the worker would, and return its requests.
- L234 `TestWhatTheButtonsAre` (class)
- L235 `test_a_schema_enum_becomes_buttons(self)` (method)
- L244 `test_a_boolean_becomes_yes_and_no(self)` (method)
- L251 `test_no_schema_becomes_a_text_input(self)` (method)
- L257 `test_a_one_of_with_titles_uses_the_titles(self)` (method)
- L263 `test_choices_are_never_invented_from_prose(self)` (method)
- L267 `test_a_choice_that_is_not_on_offer_is_refused(self)` (method)
- L273 `test_the_action_id_names_its_run(self)` (method)
- L280 `TestAskingAndAnswering` (class)
- L281 `test_an_interrupt_stores_its_question_and_its_state(self, agent: dict)` (method)
- L294 `test_the_asker_answers_and_the_agent_resumes_with_state(self, agent: dict)` (method)
- L326 `test_a_resume_is_not_a_hop(self, agent: dict)` (method)
- L344 `test_resumed_posts_have_distinct_client_ids(self, agent: dict)` (method)
- L357 `test_the_rest_route_is_the_same_entrance(self, agent: dict)` (method)
- L371 `test_the_answer_does_not_root_a_second_run(self, agent: dict)` (method)
- L384 `test_a_resume_runs_only_the_agent_that_asked(self, agent: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L405 `TestWhoMayAnswer` (class)
- L406 `test_somebody_else_cannot(self, agent: dict)` (method)
- L416 `test_a_second_answer_is_refused(self, agent: dict)` (method)
- L433 `test_the_same_click_twice_is_one_decision(self, agent: dict)` (method)
- L443 `test_a_pressed_decision_is_not_webhooked_to_the_agent(self, agent: dict)` (method)
- L464 `TestWaiting` (class)
- L465 `test_a_waiting_run_stays_listed_past_an_hour(self, agent: dict)` (method)
- L479 `test_an_expired_decision_is_refused(self, agent: dict)` (method)
- L493 `test_the_sweep_expires_waiting_runs_and_settles_their_cards(self, agent: dict)` (method)
- L511 `test_the_agents_own_deadline_wins_when_it_is_sooner(self, agent: dict)` (method)
- L517 `TestTheOtherTransports` (class)
- L518 `test_the_builtin_gets_the_answer_as_its_next_turn(self, client: Client, model: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L578 `test_a_socket_agent_receives_the_resume_input(self, client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
