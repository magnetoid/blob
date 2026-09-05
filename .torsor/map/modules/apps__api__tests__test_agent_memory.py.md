---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/tests/test_agent_memory.py

Symbols in `apps/api/tests/test_agent_memory.py`.

- L43 `remembers(state: dict)` (function) — A run that shares some state and answers.
- L52 `last_request_state(agent: dict)` (function)
- L56 `memory_rows()` (function)
- L66 `TestWhatIsRemembered` (class)
- L67 `test_state_shared_in_one_run_reaches_the_next_in_the_same_conversation(self, agent: dict)` (method)
- L77 `test_deltas_are_applied_before_it_is_kept(self, agent: dict)` (method)
- L88 `test_a_run_that_shares_nothing_leaves_the_memory_alone(self, agent: dict)` (method)
- L95 `test_the_newest_state_replaces_the_old_whole(self, agent: dict)` (method)
- L104 `TestWhereItIsRemembered` (class)
- L105 `test_a_thread_is_its_own_conversation(self, agent: dict)` (method)
- L123 `test_memory_is_per_agent(self, agent: dict)` (method)
- L132 `TestWhatIsNot` (class)
- L133 `test_a_failed_run_does_not_overwrite_what_was_remembered(self, agent: dict)` (method)
- L145 `test_state_over_the_cap_is_not_remembered(self, agent: dict)` (method)
- L153 `test_a_resume_carries_the_state_it_stopped_with_not_the_memory(self, agent: dict)` (method)
