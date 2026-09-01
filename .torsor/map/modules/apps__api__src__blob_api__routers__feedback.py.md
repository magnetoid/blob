---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/routers/feedback.py

Symbols in `apps/api/src/blob_api/routers/feedback.py`.

- L27 `TicketOut` (class)
- L31 `TicketsOut` (class)
- L35 `OkOut` (class)
- L40 `submit(payload: FeedbackInput, user: SessionUser=Depends(current_user))` (function)
- L49 `listing(status: str | None=None, user: SessionUser=Depends(require_admin))` (function)
- L58 `snapshot(ticket_id: IdParam, user: SessionUser=Depends(require_admin))` (function) — The captured page, served for an iframe to render.
- L84 `set_status(ticket_id: IdParam, payload: FeedbackStatusInput, request: Request, user: SessionUser=Depends(require_admin))` (function)
- L95 `remove(ticket_id: IdParam, request: Request, user: SessionUser=Depends(require_admin))` (function)
