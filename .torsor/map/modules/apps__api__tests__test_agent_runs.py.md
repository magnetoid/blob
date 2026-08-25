---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
---

# apps/api/tests/test_agent_runs.py

Symbols in `apps/api/tests/test_agent_runs.py`.

- L62 `agent(team: dict, monkeypatch: pytest.MonkeyPatch)` (function) — An installed agent in #general, with a swappable answer.
- L86 `ask(agent: dict, *chunks: bytes, status: int=200)` (function) — Mention the agent, let it answer with `chunks`, and return the trigger id.
- L95 `runs_of(agent: dict)` (function)
- L103 `TestWhatIsRecorded` (class)
- L104 `test_an_answer_is_recorded_as_succeeded(self, agent: dict)` (method)
- L118 `test_a_refusal_is_recorded_with_its_reason(self, agent: dict)` (method)
- L125 `test_an_agent_that_answers_badly_is_recorded(self, agent: dict)` (method)
- L132 `test_needing_a_decision_is_not_a_failure(self, agent: dict)` (method)
- L141 `test_saying_nothing_is_a_success(self, agent: dict)` (method)
- L151 `TestTheLog` (class)
- L152 `test_the_newest_run_is_first(self, agent: dict)` (method)
- L159 `test_a_run_outlives_the_message_that_started_it(self, agent: dict)` (method)
- L169 `test_a_member_cannot_read_it(self, agent: dict)` (method)
- L176 `TestRetention` (class)
- L177 `test_a_run_that_never_finished_is_closed(self, agent: dict)` (method)
- L198 `test_old_runs_are_dropped(self, agent: dict)` (method)
