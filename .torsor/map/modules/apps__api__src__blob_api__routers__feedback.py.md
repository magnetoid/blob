---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/feedback.py

Symbols in `apps/api/src/blob_api/routers/feedback.py`.

- L27 `TicketOut` (class)
- L31 `TicketsOut` (class)
- L36 `submit(payload: FeedbackInput, user: SessionUser=Depends(current_user))` (function)
- L45 `listing(status: str | None=None, user: SessionUser=Depends(require_admin))` (function)
- L54 `snapshot(ticket_id: IdParam, user: SessionUser=Depends(require_admin))` (function) — The captured page, served for an iframe to render.
- L80 `set_status(ticket_id: IdParam, payload: FeedbackStatusInput, request: Request, user: SessionUser=Depends(require_admin))` (function)
- L91 `remove(ticket_id: IdParam, request: Request, user: SessionUser=Depends(require_admin))` (function)
