---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/routers/calls.py

Symbols in `apps/api/src/blob_api/routers/calls.py`.

- L25 `calls_state(user: SessionUser=Depends(current_user))` (function)
- L31 `start_call(input_: CallStart, user: SessionUser=Depends(current_user))` (function)
- L38 `call_token(call_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L46 `end_call(call_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L53 `livekit_webhook(request: Request)` (function) — LiveKit's webhooks. Public — LiveKit holds no session — and listed as an exact
