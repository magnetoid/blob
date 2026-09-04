---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:51'
updated: '2026-09-04T17:42:51'
---

# apps/api/tests/test_help_parity.py

Symbols in `apps/api/tests/test_help_parity.py`.

- L29 `help_source()` (function)
- L34 `_cited_commands(source: str)` (function) — Every name in a `commands: ['a', 'b']` field of a topic.
- L42 `_local_commands()` (function) — The names the client answers itself, which never reach this server.
- L51 `test_every_command_the_guide_cites_exists(help_source: str)` (function)
- L59 `test_the_guide_covers_the_commands_that_change_something(help_source: str)` (function) — Not every command needs a topic — but the ones with consequences do.
