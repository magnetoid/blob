---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:03:24'
updated: '2026-08-21T06:03:24'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L27 `ThreadUpdate` (class)
- L34 `as_event(self)` (method)
- L46 `SendResult` (class)
- L54 `display_name_index(session: AsyncSession, workspace_id: str)` (function) — Lowercased display name → user id, for mention resolution.
- L70 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None)` (function)
- L261 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L327 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L344 `by_id(session: AsyncSession, message_id: str)` (function)
- L354 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L393 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L438 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L456 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L474 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L490 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L506 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads the user started or replied to, most recently active first.
