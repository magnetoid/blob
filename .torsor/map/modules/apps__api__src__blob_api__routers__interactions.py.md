---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/src/blob_api/routers/interactions.py

Symbols in `apps/api/src/blob_api/routers/interactions.py`.

- L35 `InteractionInput` (class)
- L46 `OkOut` (class)
- L51 `interact(payload: InteractionInput, user: SessionUser=Depends(current_user))` (function)
- L107 `_first_delivery(user_id: str, payload: InteractionInput)` (function) — True the first time this click is seen; fails open when Redis is away.
