---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/interactions.py

Symbols in `apps/api/src/blob_api/routers/interactions.py`.

- L34 `InteractionInput` (class)
- L45 `OkOut` (class)
- L50 `interact(payload: InteractionInput, user: SessionUser=Depends(current_user))` (function)
- L106 `_first_delivery(user_id: str, payload: InteractionInput)` (function) — True the first time this click is seen; fails open when Redis is away.
