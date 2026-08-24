---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-24T16:51:20'
updated: '2026-08-24T16:51:20'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L28 `ThreadUpdate` (class)
- L35 `as_event(self)` (method)
- L47 `SendResult` (class)
- L55 `display_name_matches(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased display name → user id for names this body could actually mention.
- L79 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L274 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L340 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L357 `by_id(session: AsyncSession, message_id: str)` (function)
- L367 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L406 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L451 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L469 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L487 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L503 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L519 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads the user started or replied to, most recently active first.
