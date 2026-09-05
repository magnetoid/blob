---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/src/blob_api/routers/commands.py

Symbols in `apps/api/src/blob_api/routers/commands.py`.

- L47 `CommandOut` (class) — What the invoker sees.
- L62 `_response_url(token: str)` (function)
- L67 `run_command(payload: RunCommandInput, user: SessionUser=Depends(current_user))` (function)
- L290 `_run_app_command(payload: RunCommandInput, user: SessionUser, *, name: str, args: str)` (function) — Ask an app, then write whatever it said.
- L371 `_post_as_bot(*, workspace_id: str, channel_id: str, bot_user_id: str, body: str, client_msg_id: str)` (function) — Write an app's in-channel answer, then broadcast it once committed.
- L403 `deferred_response(token: str, body: dict[str, object])` (function) — An app answering a command it took too long to answer inline.
