---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
---

# apps/api/src/blob_api/services/agent_shell.py

Symbols in `apps/api/src/blob_api/services/agent_shell.py`.

- L38 `Target` (class) — The agent a terminal was asked for, once it is established there is one.
- L46 `resolve_for_bot_user(actor: Actor, user_id: str)` (function) — The agent behind a bot's user row, or the reason there is no terminal for it.
- L80 `resolve(actor: Actor, plugin_id: str)` (function) — The agent, or the reason there is no terminal for it.
- L115 `open_session(actor: Actor, target: Target, *, cols: int, rows: int)` (function) — A terminal, bracketed by the record that it existed.
- L137 `_record(actor: Actor, target: Target, action: str, extra: dict[str, object])` (function) — Append to the log, and never let failing to do so end the session.
