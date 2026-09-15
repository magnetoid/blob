---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T23:40:19'
updated: '2026-09-15T23:40:19'
---

# apps/api/src/blob_api/services/messages.py

Symbols in `apps/api/src/blob_api/services/messages.py`.

- L34 `ThreadUpdate` (class)
- L41 `as_event(self)` (method)
- L53 `SendResult` (class)
- L61 `mention_targets(session: AsyncSession, workspace_id: str, body: str)` (function) — Lowercased handle → what it names, for handles this body could actually mention.
- L99 `send(session: AsyncSession, *, workspace_id: str, channel_id: str, author_id: str, body: str, client_msg_id: str, thread_root_id: str | None=None, also_in_channel: bool=False, attachment_ids: list[str] | None=None, kind: str='user', plugin_id: str | None=None, blocks: list[dict[str, Any]] | None=None)` (function)
- L232 `_assert_thread_root(session: AsyncSession, root_id: str, channel_id: str)` (function) — A reply's root has to exist and be in the same channel.
- L243 `_bind_attachments(session: AsyncSession, message_id: str, attachment_ids: list[str], *, uploader_id: str)` (function) — Only the uploader's own unbound attachments can be attached.
- L265 `_count_reply(session: AsyncSession, root_id: str, message_id: str, *, author_id: str, channel_id: str)` (function) — A reply lands: the root's counters move, and the author follows the thread.
- L317 `_mark_author_read(session: AsyncSession, author_id: str, channel_id: str, message_id: str)` (function) — The author has, by definition, read their own message.
- L345 `history(session: AsyncSession, channel_id: str, *, before: str | None=None, after: str | None=None, around: str | None=None, limit: int=50)` (function) — Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes.
- L411 `thread(session: AsyncSession, root_id: str)` (function) — A thread: its root plus every reply, oldest first.
- L433 `changed_since(session: AsyncSession, gaps: list[tuple[str, str]], *, limit: int)` (function) — Everything a reconnecting client missed, for every (channel, last-seen id) at once.
- L482 `load_for(session: AsyncSession, user_id: str, message_id: str, *, allow_deleted: bool=False, require_member: bool=False, require_writable: bool=False, gone: Callable[[], Exception]=message_gone)` (function) — The prologue every per-message route performs: fetch, refuse the missing and
- L515 `by_id(session: AsyncSession, message_id: str)` (function)
- L525 `edit(session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str)` (function)
- L566 `replace_blocks(session: AsyncSession, message_id: str, blocks: list[dict[str, Any]] | None)` (function) — Swap the structured content under a message without touching its text.
- L592 `remove(session: AsyncSession, message_id: str, user_id: str, is_admin: bool)` (function) — Soft delete.
- L642 `addressed_by_the_room(session: AsyncSession, *, channel_id: str)` (function) — Whether a message here needs no `@name` to reach an agent.
- L684 `announce(session: AsyncSession, after: Any, result: SendResult, *, workspace_id: str, channel_id: str, start_agent_runs: bool=True)` (function) — Everything that has to happen because a message now exists.
