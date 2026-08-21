---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T22:34:51'
updated: '2026-08-21T22:34:51'
---

# apps/api/src/blob_api/services/channels.py

Symbols in `apps/api/src/blob_api/services/channels.py`.

- L39 `list_for_user(session: AsyncSession, user_id: str, workspace_id: str)` (function) — Channels the user belongs to, plus public channels they could join.
- L60 `get_for_user(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L73 `ChannelAccess` (class)
- L81 `assert_channel_access(session: AsyncSession, user_id: str, channel_id: str, *, require_member: bool=False, require_writable: bool=False)` (function) — Authorize a user against a channel.
- L131 `member_ids(session: AsyncSession, channel_id: str)` (function)
- L141 `add_members(session: AsyncSession, channel_id: str, user_ids: list[str])` (function)
- L168 `create_channel(session: AsyncSession, *, workspace_id: str, created_by: str, name: str, kind: str, topic: str | None=None, description: str | None=None, extra_member_ids: list[str] | None=None)` (function)
- L210 `join(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L214 `leave(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L221 `dm_key(user_ids: list[str])` (function) — DMs are addressed by their member set, so opening one twice returns one channel.
- L227 `find_or_create_dm(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function)
- L273 `_is_unique_violation(exc: Exception)` (function)
- L278 `unique_violation(exc: Exception)` (function)
