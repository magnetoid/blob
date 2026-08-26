---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L28 `ThreadUpdate` (class)
- L35 `as_event(self)` (method)
- L47 `SendResult` (class)
- L55 `mention_targets(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased handle → what it names, for handles this body could actually mention.
- L93 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L290 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L356 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L378 `by_id(session: AsyncSession, message_id: str)` (function)
- L388 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L429 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L475 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L493 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L512 `set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool)` (function) — Put a message aside, or take it back off the list.
- L543 `list_saved(session: AsyncSession, user_id: str, limit: int=100)` (function) — Somebody's saved messages, newest save first.
- L572 `saved_message_ids(session: AsyncSession, user_id: str, limit: int=500)` (function) — Just the ids, for the boot payload.
- L600 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L616 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L632 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads the user started or replied to, most recently active first.
