---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:50:54'
updated: '2026-08-26T03:50:54'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L49 `HistoryOut` (class)
- L54 `MessagesOut` (class)
- L58 `MessageOut` (class)
- L62 `MessageTranslationOut` (class)
- L66 `ReadStateResponse` (class)
- L70 `ReadStatesOut` (class)
- L75 `OkOut` (class)
- L79 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L89 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L106 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L168 `get_message(message_id: str, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L189 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L200 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L257 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L265 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L295 `delete_message(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L346 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L364 `save_message(message_id: str, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L389 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the Later view.
- L398 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L432 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L471 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L486 `mark_unread(channel_id: str, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L511 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L520 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
