---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-20T16:39:00'
updated: '2026-08-20T16:39:00'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L43 `HistoryOut` (class)
- L48 `MessagesOut` (class)
- L52 `MessageOut` (class)
- L56 `ReadStateResponse` (class)
- L60 `ReadStatesOut` (class)
- L65 `OkOut` (class)
- L69 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L79 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L96 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L149 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L160 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L168 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L197 `delete_message(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L232 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L251 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L284 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L317 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L332 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L341 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
