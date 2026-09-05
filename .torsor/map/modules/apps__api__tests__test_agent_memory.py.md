---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/tests/test_agent_memory.py

Symbols in `apps/api/tests/test_agent_memory.py`.

- L38 `remembers(state: dict)` (function) — A run that shares some state and answers.
- L47 `last_request_state(agent: dict)` (function)
- L51 `memory_rows()` (function)
- L61 `TestWhatIsRemembered` (class)
- L62 `test_state_shared_in_one_run_reaches_the_next_in_the_same_conversation(self, agent: dict)` (method)
- L72 `test_deltas_are_applied_before_it_is_kept(self, agent: dict)` (method)
- L83 `test_a_run_that_shares_nothing_leaves_the_memory_alone(self, agent: dict)` (method)
- L90 `test_the_newest_state_replaces_the_old_whole(self, agent: dict)` (method)
- L99 `TestWhereItIsRemembered` (class)
- L100 `test_a_thread_is_its_own_conversation(self, agent: dict)` (method)
- L118 `test_memory_is_per_agent(self, agent: dict)` (method)
- L127 `TestWhatIsNot` (class)
- L128 `test_a_failed_run_does_not_overwrite_what_was_remembered(self, agent: dict)` (method)
- L140 `test_state_over_the_cap_is_not_remembered(self, agent: dict)` (method)
- L148 `test_a_resume_carries_the_state_it_stopped_with_not_the_memory(self, agent: dict)` (method)
