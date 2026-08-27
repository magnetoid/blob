---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L52 `HistoryOut` (class)
- L57 `MessagesOut` (class)
- L61 `MessageOut` (class)
- L65 `MessageTranslationOut` (class)
- L69 `ReadStateResponse` (class)
- L73 `ReadStatesOut` (class)
- L78 `OkOut` (class)
- L82 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L91 `load_message_for(session: AsyncSession, user: SessionUser, message_id: str, *, allow_deleted: bool=False, require_member: bool=False, require_writable: bool=False)` (function) — The prologue every per-message route performed by hand, seven slightly
- L123 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L140 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L202 `get_message(message_id: str, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L220 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L229 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L283 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L291 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L316 `delete_message(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L364 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L379 `save_message(message_id: str, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L399 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the flat form the older client read.
- L406 `LaterItemOut` (class)
- L414 `LaterOut` (class)
- L418 `LaterInput` (class)
- L426 `list_later(state: Literal['in_progress', 'archived', 'done']='in_progress', user: SessionUser=Depends(current_user))` (function) — The Later view proper: saved messages with their state and reminder.
- L437 `update_later(message_id: str, payload: LaterInput, user: SessionUser=Depends(current_user))` (function) — Move a saved item between states, or set a reminder on it.
- L473 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L504 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L541 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L556 `mark_unread(channel_id: str, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L581 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L590 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
