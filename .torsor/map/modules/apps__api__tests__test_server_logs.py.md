---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_server_logs.py

Symbols in `apps/api/tests/test_server_logs.py`.

- L29 `founder(client: Client)` (function) — The first signup: owner of the first workspace, and the server's instance admin.
- L34 `drain()` (function) — Let the handler's fire-and-forget writes reach Redis.
- L45 `logs_of(founder: Client, query: str='')` (function)
- L51 `TestWhatIsCaptured` (class)
- L52 `test_a_warning_reaches_the_console(self, founder: Client)` (method)
- L61 `test_an_exception_brings_its_traceback(self, founder: Client)` (method)
- L74 `test_routine_chatter_is_not_kept(self, founder: Client)` (method)
- L82 `test_the_newest_is_first(self, founder: Client)` (method)
- L94 `test_the_handlers_own_failures_are_dropped(self, founder: Client, muted: str)` (method)
- L103 `TestReading` (class)
- L104 `test_it_can_be_narrowed_to_errors(self, founder: Client)` (method)
- L112 `test_it_says_how_much_it_can_hold(self, founder: Client)` (method)
- L118 `test_clearing_empties_it(self, founder: Client)` (method)
- L126 `test_clearing_is_audited(self, founder: Client)` (method)
- L133 `TestAccess` (class)
- L134 `test_a_workspace_admin_is_not_an_instance_admin(self, founder: Client)` (method)
- L143 `test_a_member_gets_nowhere(self, founder: Client)` (method)
- L147 `test_a_stranger_gets_nowhere(self, founder: Client)` (method)
- L151 `BrokenClient` (class) — A client whose every command fails, the way one bound to a closed loop does.
- L154 `lrange(self, *_args: object, **_kwargs: object)` (method)
- L157 `lpush(self, *_args: object, **_kwargs: object)` (method)
- L160 `delete(self, *_args: object, **_kwargs: object)` (method)
- L163 `aclose(self)` (method)
- L167 `TestItNeverBreaksAnything` (class)
- L168 `test_a_broken_buffer_costs_diagnostics_and_nothing_else(self, founder: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L177 `test_a_failed_write_does_not_raise_into_the_caller(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L186 `test_it_does_not_share_the_client_everything_else_uses(self)` (method)
