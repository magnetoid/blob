---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T14:35:36'
updated: '2026-08-25T14:35:36'
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
- L105 `TestReading` (class)
- L106 `test_it_can_be_narrowed_to_errors(self, founder: Client)` (method)
- L114 `test_it_says_how_much_it_can_hold(self, founder: Client)` (method)
- L120 `test_clearing_empties_it(self, founder: Client)` (method)
- L128 `test_clearing_is_audited(self, founder: Client)` (method)
- L135 `TestAccess` (class)
- L136 `test_a_workspace_admin_is_not_an_instance_admin(self, founder: Client)` (method)
- L145 `test_a_member_gets_nowhere(self, founder: Client)` (method)
- L149 `test_a_stranger_gets_nowhere(self, founder: Client)` (method)
- L153 `BrokenClient` (class) — A client whose every command fails, the way one bound to a closed loop does.
- L156 `lrange(self, *_args: object, **_kwargs: object)` (method)
- L159 `lpush(self, *_args: object, **_kwargs: object)` (method)
- L162 `delete(self, *_args: object, **_kwargs: object)` (method)
- L165 `aclose(self)` (method)
- L169 `TestItNeverBreaksAnything` (class)
- L170 `test_a_broken_buffer_costs_diagnostics_and_nothing_else(self, founder: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L179 `test_a_failed_write_does_not_raise_into_the_caller(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L188 `test_it_does_not_share_the_client_everything_else_uses(self)` (method)
