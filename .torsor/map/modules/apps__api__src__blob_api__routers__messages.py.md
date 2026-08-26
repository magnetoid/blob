---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L50 `HistoryOut` (class)
- L55 `MessagesOut` (class)
- L59 `MessageOut` (class)
- L63 `MessageTranslationOut` (class)
- L67 `ReadStateResponse` (class)
- L71 `ReadStatesOut` (class)
- L76 `OkOut` (class)
- L80 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L90 `load_message_for(session: AsyncSession, user: SessionUser, message_id: str, *, allow_deleted: bool=False, require_member: bool=False, require_writable: bool=False)` (function) — The prologue every per-message route performed by hand, seven slightly
- L121 `get_history(channel_id: str, before: str | None=None, after: str | None=None, around: str | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L138 `send_message(channel_id: str, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L200 `get_message(message_id: str, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L218 `get_thread(message_id: str, user: SessionUser=Depends(current_user))` (function)
- L227 `translate_message(message_id: str, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L281 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L289 `edit_message(message_id: str, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L314 `delete_message(message_id: str, request: Request, user: SessionUser=Depends(current_user))` (function)
- L362 `pin_message(message_id: str, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L377 `save_message(message_id: str, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L397 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the Later view.
- L406 `add_reaction(message_id: str, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L437 `remove_reaction(message_id: str, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L474 `mark_read(channel_id: str, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L489 `mark_unread(channel_id: str, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L514 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L523 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
