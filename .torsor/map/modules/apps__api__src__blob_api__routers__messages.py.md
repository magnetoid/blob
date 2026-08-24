---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T17:27:50'
updated: '2026-08-24T17:27:50'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L47 `HistoryOut` (class)
- L52 `MessagesOut` (class)
- L56 `MessageOut` (class)
- L60 `MessageTranslationOut` (class)
- L64 `ReadStateResponse` (class)
- L68 `ReadStatesOut` (class)
- L73 `OkOut` (class)
- L77 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L87 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L104 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L166 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L177 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L234 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L242 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L272 `delete_message(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L323 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L342 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L376 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L415 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L430 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L439 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
