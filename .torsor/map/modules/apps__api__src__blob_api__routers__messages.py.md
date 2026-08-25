---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T04:30:13'
updated: '2026-08-25T04:30:13'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L48 `HistoryOut` (class)
- L53 `MessagesOut` (class)
- L57 `MessageOut` (class)
- L61 `MessageTranslationOut` (class)
- L65 `ReadStateResponse` (class)
- L69 `ReadStatesOut` (class)
- L74 `OkOut` (class)
- L78 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L88 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L105 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L167 `get_message(message_id: str, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L188 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L199 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L256 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L264 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L294 `delete_message(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L345 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L363 `save_message(message_id: str, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L388 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the Later view.
- L397 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L431 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L470 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L485 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L494 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
