---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/src/blob_api/routers/interactions.py

Symbols in `apps/api/src/blob_api/routers/interactions.py`.

- L37 `InteractionInput` (class)
- L48 `OkOut` (class)
- L53 `interact(payload: InteractionInput, user: SessionUser=Depends(current_user))` (function)
- L129 `_first_delivery(user_id: str, payload: InteractionInput)` (function) — True the first time this click is seen; fails open when Redis is away.
