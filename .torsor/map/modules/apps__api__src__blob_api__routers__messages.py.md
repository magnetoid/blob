---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L54 `HistoryOut` (class)
- L59 `MessagesOut` (class)
- L63 `MessageOut` (class)
- L67 `MessageTranslationOut` (class)
- L71 `ReadStateResponse` (class)
- L75 `ReadStatesOut` (class)
- L80 `OkOut` (class)
- L84 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L93 `load_message_for(session: AsyncSession, user: SessionUser, message_id: str, *, allow_deleted: bool=False, require_member: bool=False, require_writable: bool=False)` (function) — The prologue every per-message route performed by hand, seven slightly
- L125 `get_history(channel_id: IdParam, before: IdParam | None=None, after: IdParam | None=None, around: IdParam | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L145 `send_message(channel_id: IdParam, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L207 `get_message(message_id: IdParam, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L225 `get_thread(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L234 `translate_message(message_id: IdParam, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L288 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads the user started or replied to — the sidebar's Threads view.
- L296 `edit_message(message_id: IdParam, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L321 `delete_message(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L369 `pin_message(message_id: IdParam, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L384 `save_message(message_id: IdParam, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L404 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the flat form the older client read.
- L411 `LaterItemOut` (class)
- L419 `LaterOut` (class)
- L423 `LaterInput` (class)
- L431 `list_later(state: Literal['in_progress', 'archived', 'done']='in_progress', user: SessionUser=Depends(current_user))` (function) — The Later view proper: saved messages with their state and reminder.
- L442 `update_later(message_id: IdParam, payload: LaterInput, user: SessionUser=Depends(current_user))` (function) — Move a saved item between states, or set a reminder on it.
- L478 `add_reaction(message_id: IdParam, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L509 `remove_reaction(message_id: IdParam, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L546 `mark_read(channel_id: IdParam, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L561 `mark_unread(channel_id: IdParam, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L586 `mark_all_read(user: SessionUser=Depends(current_user))` (function) — Slack's Shift+Esc: everything, everywhere, read.
- L604 `ScheduleInput` (class)
- L611 `ScheduledOut` (class)
- L615 `ScheduledListOut` (class)
- L620 `schedule_message(channel_id: IdParam, payload: ScheduleInput, user: SessionUser=Depends(current_user))` (function) — Write it now, send it then.
- L647 `list_scheduled(user: SessionUser=Depends(current_user))` (function) — Only ever your own: a scheduled message is private until it is sent.
- L655 `cancel_scheduled(scheduled_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L664 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L673 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
