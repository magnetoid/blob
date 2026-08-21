---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:12:06'
updated: '2026-08-21T07:12:06'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L45 `HistoryOut` (class)
- L50 `MessagesOut` (class)
- L54 `MessageOut` (class)
- L58 `MessageTranslationOut` (class)
- L62 `ReadStateResponse` (class)
- L66 `ReadStatesOut` (class)
- L71 `OkOut` (class)
- L75 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L85 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L102 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L155 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L166 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L213 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L221 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L250 `delete_message(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L285 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L304 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L337 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L370 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L385 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L394 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
