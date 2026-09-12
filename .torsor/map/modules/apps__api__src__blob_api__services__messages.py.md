---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L34 `ThreadUpdate` (class)
- L41 `as_event(self)` (method)
- L53 `SendResult` (class)
- L61 `mention_targets(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased handle → what it names, for handles this body could actually mention.
- L99 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L327 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L393 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L415 `by_id(session: AsyncSession, message_id: str)` (function)
- L425 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L466 `replace_blocks(session: AsyncSession, message_id: str, blocks: list[dict[str, Any]] | None)` (function) — Swap the structured content under a message without touching its text.
- L492 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L538 `set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool)` (function)
- L556 `list_pinned(session: AsyncSession, channel_id: str)` (function)
- L575 `set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool)` (function) — Put a message aside, or take it back off the list.
- L606 `set_later(session: AsyncSession, message_id: str, user_id: str, *, state: str | None=None, remind_at: Any | None=_UNSET, note: Any=_UNSET)` (function) — Update a saved item's Later fields, saving it first if it wasn't.
- L656 `list_later(session: AsyncSession, user_id: str, *, state: str='in_progress', limit: int=100)` (function) — The Later view: saved messages in one state, with their reminder metadata.
- L696 `list_saved(session: AsyncSession, user_id: str, limit: int=100)` (function) — Somebody's saved messages, newest save first.
- L725 `saved_message_ids(session: AsyncSession, user_id: str, limit: int=500)` (function) — Just the ids, for the boot payload.
- L753 `add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L776 `remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str)` (function)
- L792 `threads_for_user(session: AsyncSession, user_id: str, limit: int=30)` (function) — Threads you follow, most recently active first, and which of them have new replies.
- L835 `thread_following(session: AsyncSession, user_id: str, root_id: str)` (function) — Whether this person is following that thread.
- L851 `set_thread_following(session: AsyncSession, user_id: str, root_id: str, following: bool)` (function) — Follow a thread, or stop.
- L882 `mark_thread_read(session: AsyncSession, user_id: str, root_id: str)` (function) — Move the thread's read cursor to its newest reply.
- L910 `addressed_by_the_room(session: AsyncSession, *, channel_id: str)` (function) — Whether a message here needs no `@name` to reach an agent.
- L948 `announce(session: AsyncSession, after: Any, result: SendResult, *, workspace_id: str, channel_id: str, start_agent_runs: bool=True)` (function) — Everything that has to happen because a message now exists.
