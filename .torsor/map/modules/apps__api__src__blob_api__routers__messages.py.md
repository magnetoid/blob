---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L65 `HistoryOut` (class)
- L70 `MessageTranslationOut` (class)
- L74 `ReadStateResponse` (class)
- L78 `ReadStatesOut` (class)
- L83 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L93 `get_history(channel_id: IdParam, before: IdParam | None=None, after: IdParam | None=None, around: IdParam | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L113 `send_message(channel_id: IdParam, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L152 `get_message(message_id: IdParam, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L170 `get_thread(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L179 `translate_message(message_id: IdParam, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L227 `ThreadsOut` (class)
- L234 `ThreadFollowOut` (class)
- L239 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads you follow — the sidebar's Threads view.
- L247 `thread_following(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L257 `set_thread_following(message_id: IdParam, payload: FollowThreadInput, user: SessionUser=Depends(current_user))` (function) — Follow a thread, or stop following one.
- L274 `mark_thread_read(message_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Move the thread's read cursor to its newest reply.
- L283 `edit_message(message_id: IdParam, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L308 `delete_message(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L356 `pin_message(message_id: IdParam, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L371 `save_message(message_id: IdParam, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L391 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the flat form the older client read.
- L398 `LaterItemOut` (class)
- L406 `LaterOut` (class)
- L410 `LaterInput` (class)
- L418 `list_later(state: Literal['in_progress', 'archived', 'done']='in_progress', user: SessionUser=Depends(current_user))` (function) — The Later view proper: saved messages with their state and reminder.
- L429 `update_later(message_id: IdParam, payload: LaterInput, user: SessionUser=Depends(current_user))` (function) — Move a saved item between states, or set a reminder on it.
- L462 `add_reaction(message_id: IdParam, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L494 `remove_reaction(message_id: IdParam, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L532 `mark_read(channel_id: IdParam, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L547 `mark_unread(channel_id: IdParam, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L572 `mark_all_read(user: SessionUser=Depends(current_user))` (function) — Slack's Shift+Esc: everything, everywhere, read.
- L590 `ScheduleInput` (class)
- L603 `ScheduledOut` (class)
- L607 `ScheduledListOut` (class)
- L612 `schedule_message(channel_id: IdParam, payload: ScheduleInput, user: SessionUser=Depends(current_user))` (function) — Write it now, send it then.
- L636 `list_scheduled(user: SessionUser=Depends(current_user))` (function) — Only ever your own: a scheduled message is private until it is sent.
- L644 `cancel_scheduled(scheduled_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L653 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L662 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
