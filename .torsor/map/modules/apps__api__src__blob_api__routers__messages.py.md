---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/messages.py

Symbols in `apps/api/src/blob_api/routers/messages.py`.

- L55 `HistoryOut` (class)
- L60 `MessagesOut` (class)
- L64 `MessageOut` (class)
- L68 `MessageTranslationOut` (class)
- L72 `ReadStateResponse` (class)
- L76 `ReadStatesOut` (class)
- L81 `OkOut` (class)
- L85 `_plugin_drain()` (function) — Nudge the worker to deliver what the transaction just queued.
- L94 `load_message_for(session: AsyncSession, user: SessionUser, message_id: str, *, allow_deleted: bool=False, require_member: bool=False, require_writable: bool=False)` (function) — The prologue every per-message route performed by hand, seven slightly
- L126 `get_history(channel_id: IdParam, before: IdParam | None=None, after: IdParam | None=None, around: IdParam | None=None, limit: Annotated[int, Query(ge=1, le=100)]=50, user: SessionUser=Depends(current_user))` (function)
- L146 `send_message(channel_id: IdParam, payload: SendMessageInput, response: Response, user: SessionUser=Depends(current_user))` (function)
- L185 `get_message(message_id: IdParam, user: SessionUser=Depends(current_user))` (function) — One message by id — what a permalink resolves against.
- L203 `get_thread(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L212 `translate_message(message_id: IdParam, payload: TranslateMessageInput, user: SessionUser=Depends(current_user))` (function)
- L265 `ThreadsOut` (class)
- L272 `ThreadFollowOut` (class)
- L277 `list_threads(user: SessionUser=Depends(current_user))` (function) — Threads you follow — the sidebar's Threads view.
- L285 `thread_following(message_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L295 `set_thread_following(message_id: IdParam, payload: FollowThreadInput, user: SessionUser=Depends(current_user))` (function) — Follow a thread, or stop following one.
- L312 `mark_thread_read(message_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Move the thread's read cursor to its newest reply.
- L321 `edit_message(message_id: IdParam, payload: EditMessageInput, user: SessionUser=Depends(current_user))` (function)
- L346 `delete_message(message_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function)
- L394 `pin_message(message_id: IdParam, payload: PinInput, user: SessionUser=Depends(current_user))` (function)
- L409 `save_message(message_id: IdParam, payload: SaveInput, user: SessionUser=Depends(current_user))` (function) — Put a message aside for yourself. Slack's Later.
- L429 `list_saved(user: SessionUser=Depends(current_user))` (function) — Everything put aside, newest first — the flat form the older client read.
- L436 `LaterItemOut` (class)
- L444 `LaterOut` (class)
- L448 `LaterInput` (class)
- L456 `list_later(state: Literal['in_progress', 'archived', 'done']='in_progress', user: SessionUser=Depends(current_user))` (function) — The Later view proper: saved messages with their state and reminder.
- L467 `update_later(message_id: IdParam, payload: LaterInput, user: SessionUser=Depends(current_user))` (function) — Move a saved item between states, or set a reminder on it.
- L500 `add_reaction(message_id: IdParam, payload: ReactionInput, user: SessionUser=Depends(current_user))` (function)
- L531 `remove_reaction(message_id: IdParam, emoji: Annotated[str, Query(min_length=1, max_length=64)], user: SessionUser=Depends(current_user))` (function)
- L568 `mark_read(channel_id: IdParam, payload: MarkReadInput, user: SessionUser=Depends(current_user))` (function)
- L583 `mark_unread(channel_id: IdParam, payload: MarkUnreadInput, user: SessionUser=Depends(current_user))` (function) — Leave a message, and everything after it, unread.
- L608 `mark_all_read(user: SessionUser=Depends(current_user))` (function) — Slack's Shift+Esc: everything, everywhere, read.
- L626 `ScheduleInput` (class)
- L639 `ScheduledOut` (class)
- L643 `ScheduledListOut` (class)
- L648 `schedule_message(channel_id: IdParam, payload: ScheduleInput, user: SessionUser=Depends(current_user))` (function) — Write it now, send it then.
- L672 `list_scheduled(user: SessionUser=Depends(current_user))` (function) — Only ever your own: a scheduled message is private until it is sent.
- L680 `cancel_scheduled(scheduled_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L689 `list_read_states(user: SessionUser=Depends(current_user))` (function)
- L698 `incoming_webhook(token: str, payload: WebhookPostInput)` (function) — Post to a channel with a token instead of a session.
