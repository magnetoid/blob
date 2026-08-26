---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/routers/feedback.py

Symbols in `apps/api/src/blob_api/routers/feedback.py`.

- L26 `TicketOut` (class)
- L30 `TicketsOut` (class)
- L34 `OkOut` (class)
- L39 `submit(payload: FeedbackInput, user: SessionUser=Depends(current_user))` (function)
- L48 `listing(status: str | None=None, user: SessionUser=Depends(require_admin))` (function)
- L57 `snapshot(ticket_id: str, user: SessionUser=Depends(require_admin))` (function) — The captured page, served for an iframe to render.
- L83 `set_status(ticket_id: str, payload: FeedbackStatusInput, request: Request, user: SessionUser=Depends(require_admin))` (function)
- L94 `remove(ticket_id: str, request: Request, user: SessionUser=Depends(require_admin))` (function)
