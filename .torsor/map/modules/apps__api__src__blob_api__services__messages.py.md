---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L34 `ThreadUpdate` (class)
- L41 `as_event(self)` (method)
- L53 `SendResult` (class)
- L61 `mention_targets(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased handle → what it names, for handles this body could actually mention.
- L99 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L296 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L362 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L384 `by_id(session: AsyncSession, message_id: str)` (function)
- L394 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L435 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L481 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L499 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L518 `set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool)` (function) — Put a message aside, or take it back off the list.
- L549 `set_later(session: AsyncSession, message_id: str, user_id: str, *, state: str | None=None, remind_at: Any | None=_UNSET, note: Any=_UNSET)` (function) — Update a saved item's Later fields, saving it first if it wasn't.
- L599 `list_later(session: AsyncSession, user_id: str, *, state: str='in_progress', limit: int=100)` (function) — The Later view: saved messages in one state, with their reminder metadata.
- L639 `list_saved(session: AsyncSession, user_id: str, limit: int=100)` (function) — Somebody's saved messages, newest save first.
- L668 `saved_message_ids(session: AsyncSession, user_id: str, limit: int=500)` (function) — Just the ids, for the boot payload.
- L696 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L712 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L728 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads the user started or replied to, most recently active first.
- L752 `announce(session: AsyncSession, after: Any, result: SendResult, *, workspace_id: str, channel_id: str)` (function) — Everything that has to happen because a message now exists.
