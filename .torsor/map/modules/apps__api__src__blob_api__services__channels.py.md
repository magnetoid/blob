---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/services/channels.py

Symbols in `apps/api/src/blob_api/services/channels.py`.

- L42 `list_for_user(session: AsyncSession, user_id: str, workspace_id: str)` (function) — Channels the user belongs to, plus public channels they could join.
- L63 `browse(session: AsyncSession, user_id: str, workspace_id: str, *, query: str='', include_archived: bool=False, limit: int=200)` (function) — The channel directory: what exists, how busy it is, whether you are in it.
- L139 `get_for_user(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L152 `ChannelAccess` (class)
- L160 `assert_channel_access(session: AsyncSession, user_id: str, channel_id: str, *, require_member: bool=False, require_writable: bool=False)` (function) — Authorize a user against a channel.
- L217 `member_ids(session: AsyncSession, channel_id: str)` (function)
- L227 `add_members(session: AsyncSession, channel_id: str, user_ids: list[str])` (function) — Put people in a channel, refusing anybody who is not in its workspace.
- L294 `create_channel(session: AsyncSession, *, workspace_id: str, created_by: str, name: str, kind: str, topic: str | None=None, description: str | None=None, extra_member_ids: list[str] | None=None)` (function)
- L336 `join(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L340 `leave(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L347 `dm_key(user_ids: list[str])` (function) — DMs are addressed by their member set, so opening one twice returns one channel.
- L353 `find_or_create_dm(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function)
