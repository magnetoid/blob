---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_agent_runs.py

Symbols in `apps/api/tests/test_agent_runs.py`.

- L63 `agent(team: dict, monkeypatch: pytest.MonkeyPatch)` (function) — An installed agent in #general, with a swappable answer.
- L87 `ask(agent: dict, *chunks: bytes, status: int=200)` (function) — Mention the agent, let it answer with `chunks`, and return the trigger id.
- L96 `runs_of(agent: dict)` (function)
- L104 `TestWhatIsRecorded` (class)
- L105 `test_an_answer_is_recorded_as_succeeded(self, agent: dict)` (method)
- L119 `test_a_refusal_is_recorded_with_its_reason(self, agent: dict)` (method)
- L126 `test_an_agent_that_answers_badly_is_recorded(self, agent: dict)` (method)
- L133 `test_needing_a_decision_is_not_a_failure(self, agent: dict)` (method)
- L142 `test_saying_nothing_is_a_success(self, agent: dict)` (method)
- L152 `TestTheLog` (class)
- L153 `test_the_newest_run_is_first(self, agent: dict)` (method)
- L160 `test_a_run_outlives_the_message_that_started_it(self, agent: dict)` (method)
- L170 `test_a_member_cannot_read_it(self, agent: dict)` (method)
- L177 `TestRetention` (class)
- L178 `test_a_run_that_never_finished_is_closed(self, agent: dict)` (method)
- L199 `test_old_runs_are_dropped(self, agent: dict)` (method)
- L214 `TestTheConsoleNumbers` (class) — The three numbers the admin table shows beside an agent: runs this week, runs in
- L218 `_row(self, agent: dict)` (method)
- L222 `test_a_finished_run_counts_for_the_week_and_not_as_live(self, agent: dict)` (method)
- L230 `test_a_run_in_flight_is_live(self, agent: dict)` (method)
- L244 `test_a_refused_run_is_not_activity(self, agent: dict)` (method)
- L253 `test_the_chart_has_every_day_and_adds_up(self, agent: dict)` (method)
- L264 `test_the_chart_is_the_admins(self, agent: dict)` (method)
