---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/interactions.py

Symbols in `apps/api/src/blob_api/routers/interactions.py`.

- L36 `InteractionInput` (class)
- L48 `interact(payload: InteractionInput, user: SessionUser=Depends(current_user))` (function)
- L108 `_first_delivery(user_id: str, payload: InteractionInput)` (function) — True the first time this click is seen; fails open when Redis is away.
