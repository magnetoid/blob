---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:49:20'
updated: '2026-09-02T05:49:20'
---

# apps/api/src/blob_api/services/channels.py

Symbols in `apps/api/src/blob_api/services/channels.py`.

- L40 `list_for_user(session: AsyncSession, user_id: str, workspace_id: str)` (function) — Channels the user belongs to, plus public channels they could join.
- L61 `browse(session: AsyncSession, user_id: str, workspace_id: str, *, query: str='', include_archived: bool=False, limit: int=200)` (function) — The channel directory: what exists, how busy it is, whether you are in it.
- L137 `get_for_user(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L150 `ChannelAccess` (class)
- L158 `assert_channel_access(session: AsyncSession, user_id: str, channel_id: str, *, require_member: bool=False, require_writable: bool=False)` (function) — Authorize a user against a channel.
- L215 `member_ids(session: AsyncSession, channel_id: str)` (function)
- L225 `add_members(session: AsyncSession, channel_id: str, user_ids: list[str])` (function) — Put people in a channel, refusing anybody who is not in its workspace.
- L292 `create_channel(session: AsyncSession, *, workspace_id: str, created_by: str, name: str, kind: str, topic: str | None=None, description: str | None=None, extra_member_ids: list[str] | None=None)` (function)
- L334 `join(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L338 `leave(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L345 `dm_key(user_ids: list[str])` (function) — DMs are addressed by their member set, so opening one twice returns one channel.
- L351 `find_or_create_dm(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function)
