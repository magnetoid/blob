---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/src/blob_api/plugins/commands.py

Symbols in `apps/api/src/blob_api/plugins/commands.py`.

- L47 `AppReply` (class) — What an app said. `None` in place of this means "later" — see `parse_reply`.
- L55 `ResponseTarget` (class) — Where a deferred answer is allowed to land, recovered from a response token.
- L63 `_b64(raw: bytes)` (function)
- L67 `_unb64(value: str)` (function)
- L71 `response_token(*, plugin_id: str, channel_id: str, user_id: str, now: int | None=None)` (function) — A bearer URL segment authorising exactly one app to answer exactly one command.
- L84 `verify_response_token(token: str, *, now: int | None=None)` (function) — Recover the target, or None for anything forged, malformed or expired.
- L110 `parse_reply(status_code: int, body: bytes)` (function) — Read what an app sent back.
- L141 `ask(*, url: str, secret: str, payload: dict[str, Any])` (function) — Ask an app to answer a command.
