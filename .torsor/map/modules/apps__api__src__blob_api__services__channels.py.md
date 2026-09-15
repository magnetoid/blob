---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-15T22:17:59'
updated: '2026-09-15T22:17:59'
---

# apps/api/src/blob_api/services/channels.py

Symbols in `apps/api/src/blob_api/services/channels.py`.

- L42 `list_for_user(session: AsyncSession, user_id: str, workspace_id: str)` (function) — Channels the user belongs to, plus public channels they could join.
- L63 `browse(session: AsyncSession, user_id: str, workspace_id: str, *, query: str='', include_archived: bool=False, limit: int=200)` (function) — The channel directory: what exists, how busy it is, whether you are in it.
- L139 `visible_to(session: AsyncSession, user_id: str, workspace_id: str, *, limit: int)` (function) — Channels this member can see: public ones, plus private ones they were let into.
- L164 `id_by_name(session: AsyncSession, workspace_id: str, name: str, *, user_id: str)` (function) — The channel a #name means to this member.
- L191 `update_settings(session: AsyncSession, channel_id: str, *, name: str | None, topic: str | None, description: str | None, nudge_unanswered: bool | None, given: set[str])` (function) — The channel's own settings. Topic and description may be cleared, so for those
- L227 `set_archived(session: AsyncSession, channel_id: str, *, archived: bool)` (function)
- L234 `update_membership(session: AsyncSession, channel_id: str, user_id: str, *, notify_level: str | None, is_starred: bool | None)` (function) — One person's settings for a channel: how loud it is, and whether it is starred.
- L261 `get_for_user(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L274 `ChannelAccess` (class)
- L282 `assert_channel_access(session: AsyncSession, user_id: str, channel_id: str, *, require_member: bool=False, require_writable: bool=False)` (function) — Authorize a user against a channel.
- L339 `member_ids(session: AsyncSession, channel_id: str)` (function)
- L349 `add_members(session: AsyncSession, channel_id: str, user_ids: list[str])` (function) — Put people in a channel, refusing anybody who is not in its workspace.
- L416 `create_channel(session: AsyncSession, *, workspace_id: str, created_by: str, name: str, kind: str, topic: str | None=None, description: str | None=None, extra_member_ids: list[str] | None=None)` (function)
- L471 `_agents_in_every_public_channel(session: AsyncSession, workspace_id: str)` (function) — The bots flagged `in_every_public_channel` at install — see `db/models.Plugin`.
- L499 `join(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L503 `leave(session: AsyncSession, channel_id: str, user_id: str)` (function)
- L510 `dm_key(user_ids: list[str])` (function) — DMs are addressed by their member set, so opening one twice returns one channel.
- L516 `find_or_create_dm(session: AsyncSession, workspace_id: str, user_ids: list[str])` (function)
- L573 `announce_created(after: Any, channel: Channel, *, channel_id: str, members: list[str], views: dict[str, ChannelWithState | None], workspace_id: str | None)` (function) — Tell the people concerned that a channel now exists, past COMMIT.
