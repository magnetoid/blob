---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/tests/test_agent_socket_guards.py

Symbols in `apps/api/tests/test_agent_socket_guards.py`.

- L48 `owner(client: Client)` (function)
- L52 `install(owner: Client, **overrides: Any)` (function)
- L59 `agent_socket(token: str)` (function)
- L69 `receive_until(ws: Any, kind: str, timeout: float=5.0)` (function)
- L79 `TestOwningARun` (class)
- L80 `test_an_agent_may_answer_the_run_it_claimed(self)` (method)
- L85 `test_another_agent_may_not(self)` (method)
- L92 `test_a_run_nobody_claimed_is_refused(self)` (method)
- L97 `test_an_event_for_someone_elses_run_is_dropped(self, owner: Client)` (method)
- L137 `TestWhatASocketAgentCannotDeclare` (class) — Configuration that installs cleanly and then quietly does nothing.
- L140 `test_events_are_refused(self, owner: Client)` (method)
- L149 `test_commands_are_refused(self, owner: Client)` (method)
- L165 `TestEditingASocketAgent` (class)
- L166 `test_a_url_cannot_be_added_afterwards(self, owner: Client)` (method)
- L180 `test_an_ordinary_edit_still_works(self, owner: Client)` (method)
- L192 `TestSeeingWhetherItIsConnected` (class)
- L193 `test_a_socket_agent_reports_offline_before_it_dials(self, owner: Client)` (method)
- L202 `test_it_reports_online_while_it_holds_the_socket(self, owner: Client)` (method)
- L211 `test_a_hosted_app_has_no_opinion(self, owner: Client)` (method)
