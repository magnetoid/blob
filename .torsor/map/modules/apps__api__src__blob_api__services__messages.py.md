---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L33 `ThreadUpdate` (class)
- L40 `as_event(self)` (method)
- L52 `SendResult` (class)
- L60 `mention_targets(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased handle → what it names, for handles this body could actually mention.
- L98 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L295 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L361 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L383 `by_id(session: AsyncSession, message_id: str)` (function)
- L393 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L434 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L480 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L498 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L517 `set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool)` (function) — Put a message aside, or take it back off the list.
- L548 `set_later(session: AsyncSession, message_id: str, user_id: str, *, state: str | None=None, remind_at: Any | None=_UNSET, note: Any=_UNSET)` (function) — Update a saved item's Later fields, saving it first if it wasn't.
- L598 `list_later(session: AsyncSession, user_id: str, *, state: str='in_progress', limit: int=100)` (function) — The Later view: saved messages in one state, with their reminder metadata.
- L638 `list_saved(session: AsyncSession, user_id: str, limit: int=100)` (function) — Somebody's saved messages, newest save first.
- L667 `saved_message_ids(session: AsyncSession, user_id: str, limit: int=500)` (function) — Just the ids, for the boot payload.
- L695 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L711 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L727 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads the user started or replied to, most recently active first.
